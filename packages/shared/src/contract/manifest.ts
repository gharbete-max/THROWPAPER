import type { ZodTypeAny } from 'zod';
import { SendMessageRequest, SendMessageResponse, DeliveryEvent } from './messages.js';
import { UpsertContactsRequest, UpsertContactsResponse } from './contacts.js';
import { PushAudienceRequest, PushAudienceResponse, PullAudienceResponse } from './audiences.js';
import { ListTemplatesResponse } from './templates.js';

export type ContractSide = 'sendwork' | 'formwork';

export interface ContractEndpoint {
  /** Stable id used by each app's registry. Never renamed without a version bump. */
  id: string;
  method: 'GET' | 'POST';
  path: string;
  /** Which app must serve it. */
  servedBy: ContractSide;
  section: string;
  request: ZodTypeAny | null;
  response: ZodTypeAny;
}

/**
 * The whole surface of docs/CONTRACT.md, in one list.
 * `pnpm contract:check` reads this and each app's registry; adding an endpoint here without
 * implementing or deferring it in the serving app fails the check.
 */
export const CONTRACT_ENDPOINTS = [
  {
    id: 'messages.send',
    method: 'POST',
    path: '/v1/messages',
    servedBy: 'sendwork',
    section: '1.1',
    request: SendMessageRequest,
    response: SendMessageResponse,
  },
  {
    id: 'contacts.upsert',
    method: 'POST',
    path: '/v1/contacts/upsert',
    servedBy: 'sendwork',
    section: '1.2',
    request: UpsertContactsRequest,
    response: UpsertContactsResponse,
  },
  {
    id: 'audiences.push',
    method: 'POST',
    path: '/v1/audiences/:key/members',
    servedBy: 'sendwork',
    section: '1.3',
    request: PushAudienceRequest,
    response: PushAudienceResponse,
  },
  {
    id: 'templates.list',
    method: 'GET',
    path: '/v1/templates',
    servedBy: 'sendwork',
    section: '1.4',
    request: null,
    response: ListTemplatesResponse,
  },
  {
    id: 'audiences.pull',
    method: 'GET',
    path: '/v1/audiences/:key/members',
    servedBy: 'formwork',
    section: '2.1',
    request: null,
    response: PullAudienceResponse,
  },
  {
    id: 'delivery.webhook',
    method: 'POST',
    path: '/hooks/delivery',
    servedBy: 'formwork',
    section: '2.2',
    request: DeliveryEvent,
    response: DeliveryEvent.pick({ messageId: true }),
  },
] as const satisfies readonly ContractEndpoint[];

export type ContractEndpointId = (typeof CONTRACT_ENDPOINTS)[number]['id'];

/** What an app claims about each endpoint it is responsible for. */
export interface ContractRegistryEntry {
  id: ContractEndpointId;
  status: 'implemented' | 'deferred';
  /** Required when deferred: which phase picks it up. */
  plannedPhase?: string;
}

export interface ContractRegistry {
  app: string;
  side: ContractSide;
  entries: ContractRegistryEntry[];
}
