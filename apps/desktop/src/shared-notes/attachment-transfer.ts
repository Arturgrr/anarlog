// The native attachment transfer plugin was removed with cloud sync; shared
// attachments fail closed until the sharing surface is removed.
export type SharedAttachmentCacheResult = {
  cacheId: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
};

type PreparedSharedUpload = {
  cacheId: string;
  sha256: string;
  sizeBytes: number;
};

export class NativeAttachmentTransferError extends Error {
  constructor(
    label: string,
    readonly nativeMessage: string,
  ) {
    super(`${label} failed: ${nativeMessage}`);
    this.name = "NativeAttachmentTransferError";
  }
}

function unavailable(label: string): Promise<never> {
  return Promise.reject(
    new NativeAttachmentTransferError(
      label,
      "attachment transfer is unavailable",
    ),
  );
}

export const attachmentTransferNative = {
  prepareSharedUpload(
    _attachmentId: string,
    _expectedSha256: string,
    _expectedSizeBytes: number,
    _expectedFilename: string,
    _expectedContentType: string,
    _expectedCloudObjectKey: string,
    _signal?: AbortSignal,
  ): Promise<PreparedSharedUpload> {
    return unavailable("prepare shared attachment upload");
  },
  readSharedUploadRange(
    _attachmentId: string,
    _cacheId: string,
    _expectedSha256: string,
    _expectedSizeBytes: number,
    _expectedFilename: string,
    _expectedContentType: string,
    _expectedCloudObjectKey: string,
    _start: number,
    _end: number,
  ): Promise<Uint8Array> {
    return unavailable("read shared attachment upload snapshot");
  },
  validateSharedUpload(
    _attachmentId: string,
    _cacheId: string,
    _expectedSha256: string,
    _expectedSizeBytes: number,
    _expectedFilename: string,
    _expectedContentType: string,
    _expectedCloudObjectKey: string,
    _signal?: AbortSignal,
  ): Promise<boolean> {
    return unavailable("validate shared attachment upload");
  },
  cleanupSharedUpload(_cacheId: string): Promise<boolean> {
    return unavailable("clean shared attachment upload snapshot");
  },
  downloadSharedAttachment(
    _input: {
      scopeId: string;
      attachmentId: string;
      signedUrl: string;
      expectedSha256: string;
      expectedSizeBytes: number;
    },
    _signal?: AbortSignal,
  ): Promise<SharedAttachmentCacheResult> {
    return unavailable("download shared attachment");
  },
  sharedAttachmentPath(
    _scopeId: string,
    _attachmentId: string,
  ): Promise<string | null> {
    return Promise.resolve(null);
  },
  removeSharedAttachment(
    _scopeId: string,
    _attachmentId: string,
  ): Promise<boolean> {
    return Promise.resolve(false);
  },
  clearSharedAttachmentScope(_scopeId: string): Promise<number> {
    return Promise.resolve(0);
  },
};
