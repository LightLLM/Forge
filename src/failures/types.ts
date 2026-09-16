export interface FailureEntry {
  id: string;
  symptom: string;
  cause: string | null;
  fix: string;
  tags: string[];
  successEvidence: string | null;
  relatedSolutionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FailureMatch {
  entry: FailureEntry;
  score: number;
  reason: string;
}

export interface CreateFailureInput {
  symptom: string;
  cause?: string;
  fix: string;
  tags?: string[];
  successEvidence?: string;
}
