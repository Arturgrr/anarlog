import { t } from "@lingui/core/macro";

export class BatchResponseProcessingError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      t`Batch transcription completed, but Librelog could not process the response.`,
    );
    this.name = "BatchResponseProcessingError";
    this.cause = cause;
  }
}
