export interface ExternalEvidenceAdapter {
  name: 'ORAP' | 'GAT';
  status(): Promise<{ available: boolean; reason: string }>;
  importEvidence(projectId: string): Promise<unknown[]>;
}
export class UnavailableAdapter implements ExternalEvidenceAdapter {
  constructor(public name: 'ORAP' | 'GAT') {}
  async status() {
    return {
      available: false,
      reason: `${this.name} challenge repository fork, API contract, and access credentials have not been supplied. No integration has executed.`,
    };
  }
  async importEvidence(_projectId: string): Promise<unknown[]> {
    throw new Error((await this.status()).reason);
  }
}
export const adapters = [new UnavailableAdapter('ORAP'), new UnavailableAdapter('GAT')];
