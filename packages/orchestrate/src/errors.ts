/** Thrown by loadFromJson()/register() when a .pipe spec will not execute. */
export class PipelineSpecError extends Error {
  readonly node_id: string | null;

  constructor(message: string, nodeId: string | null = null) {
    super(message);
    this.name = 'PipelineSpecError';
    this.node_id = nodeId;
  }
}

/** Thrown when a run cannot continue (unknown op at execution time, cycle guard). */
export class PipelineRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineRunError';
  }
}
