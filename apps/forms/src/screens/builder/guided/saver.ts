import { jsonEqual, toSession, type BuilderGraph, type Conversation } from '@tp/shared/builder';
import type { BuilderSession } from '@tp/shared/builder';
import type { FormDefinition } from '@tp/shared/forms';

/**
 * Autosave for the conversation — `PREDICTIVE-BUILDER.md`, "Autosave": after every step, the
 * draft through the same `PUT /v1/forms/:id/draft` the editor uses, then the session through
 * `PUT /v1/forms/:id/builder-session` with the version it was read at.
 *
 * - **In order, and only the latest.** Saves never overlap; steps taken while one is in flight are
 *   saved together, as the last of them, when it lands.
 * - **The draft first.** If the session then fails, the next load finds a session that no longer
 *   describes the draft and starts again from the draft: the trail is lost, the form is not.
 * - **A second tab is not overwritten.** A `409` means somebody saved over the version this tab
 *   read; the status says so, nothing more is saved, and the screen reads again.
 */

export type SaveStatus = 'saved' | 'saving' | 'failed' | 'conflict';

export interface SaverApi {
  saveDraft(formId: string, definition: FormDefinition): Promise<unknown>;
  saveBuilderSession(
    formId: string,
    version: number,
    session: BuilderSession,
  ): Promise<{ version: number }>;
}

export class Saver {
  private version: number;
  private savedDraft: FormDefinition;
  /** The newest step not yet saved. */
  private waiting: Conversation | null = null;
  /** The newest step whose save failed, for `retry`. */
  private failed: Conversation | null = null;
  private running: Promise<void> | null = null;
  status: SaveStatus = 'saved';

  constructor(
    private readonly api: SaverApi,
    private readonly graph: BuilderGraph,
    private readonly formId: string,
    start: { readonly version: number; readonly draft: FormDefinition },
    private readonly onStatus: (status: SaveStatus) => void = () => {},
  ) {
    this.version = start.version;
    this.savedDraft = start.draft;
  }

  /** Save this conversation, after whatever is saving now. Resolves when it has been tried. */
  save(conversation: Conversation): Promise<void> {
    if (this.status === 'conflict') return Promise.resolve();
    this.waiting = conversation;
    this.failed = null;
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Try the step that failed again. */
  retry(): Promise<void> {
    const again = this.failed;
    return again ? this.save(again) : Promise.resolve();
  }

  /** Resolves once nothing is saving — before leaving for the editor, which reads the draft. */
  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private set(status: SaveStatus) {
    this.status = status;
    this.onStatus(status);
  }

  private async drain(): Promise<void> {
    while (this.waiting) {
      const conversation = this.waiting;
      this.waiting = null;
      this.set('saving');
      try {
        const draft = conversation.state.draft.definition;
        if (!jsonEqual(draft, this.savedDraft)) {
          await this.api.saveDraft(this.formId, draft);
          this.savedDraft = draft;
        }
        const saved = await this.api.saveBuilderSession(
          this.formId,
          this.version,
          toSession(this.graph, conversation),
        );
        this.version = saved.version;
      } catch (error) {
        if ((error as { status?: unknown } | null)?.status === 409) {
          this.waiting = null;
          this.set('conflict');
          return;
        }
        // A retry saves the newest step: one taken while this was failing, or this one.
        this.failed = this.waiting ?? conversation;
        this.waiting = null;
        this.set('failed');
        return;
      }
    }
    this.set('saved');
  }
}
