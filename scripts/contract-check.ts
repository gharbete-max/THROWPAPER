/**
 * Validates both apps against docs/CONTRACT.md.
 *
 * The contract is frozen before either track writes code, so this check exists from phase 0 and
 * has teeth immediately: an endpoint in the manifest that no app claims is a failure, and so is
 * an app claiming an endpoint that is not in the manifest, or deferring one without naming the
 * phase that picks it up.
 */
import { CONTRACT_ENDPOINTS, CONTRACT_VERSION, type ContractRegistry } from '@tp/shared/contract';
import { registry as formsRegistry } from '@tp/api-forms/contract-registry';
import { registry as mailerRegistry } from '@tp/api-mailer/contract-registry';

const registries: ContractRegistry[] = [formsRegistry, mailerRegistry];
const problems: string[] = [];
const knownIds = new Set<string>(CONTRACT_ENDPOINTS.map((endpoint) => endpoint.id));

for (const registry of registries) {
  const seen = new Set<string>();
  for (const entry of registry.entries) {
    if (!knownIds.has(entry.id)) {
      problems.push(`${registry.app} claims "${entry.id}", which is not in docs/CONTRACT.md`);
      continue;
    }
    if (seen.has(entry.id)) {
      problems.push(`${registry.app} lists "${entry.id}" twice`);
    }
    seen.add(entry.id);

    const endpoint = CONTRACT_ENDPOINTS.find((candidate) => candidate.id === entry.id);
    if (endpoint && endpoint.servedBy !== registry.side) {
      problems.push(
        `${registry.app} (${registry.side}) claims "${entry.id}", which is served by ${endpoint.servedBy}`,
      );
    }
    if (entry.status === 'deferred' && !entry.plannedPhase) {
      problems.push(`${registry.app} defers "${entry.id}" without naming a phase`);
    }
  }
}

for (const endpoint of CONTRACT_ENDPOINTS) {
  const owner = registries.find((registry) => registry.side === endpoint.servedBy);
  if (!owner) {
    problems.push(`no app registered for side "${endpoint.servedBy}" (${endpoint.id})`);
    continue;
  }
  if (!owner.entries.some((entry) => entry.id === endpoint.id)) {
    problems.push(
      `${owner.app} does not account for "${endpoint.id}" (CONTRACT §${endpoint.section}) — implement it or defer it with a phase`,
    );
  }
}

const rows = CONTRACT_ENDPOINTS.map((endpoint) => {
  const owner = registries.find((registry) => registry.side === endpoint.servedBy);
  const entry = owner?.entries.find((candidate) => candidate.id === endpoint.id);
  return {
    '§': endpoint.section,
    endpoint: `${endpoint.method} ${endpoint.path}`,
    servedBy: endpoint.servedBy,
    status: entry?.status ?? 'UNACCOUNTED',
    phase: entry?.plannedPhase ?? '',
  };
});

console.log(`contract version ${CONTRACT_VERSION}`);
console.table(rows);

if (problems.length > 0) {
  console.error('\ncontract:check failed');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const implemented = rows.filter((row) => row.status === 'implemented').length;
console.log(`contract:check passed — ${implemented}/${rows.length} implemented, rest deferred`);
