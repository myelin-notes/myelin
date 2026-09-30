export interface GoogleDriveFailureDiagnostics {
  google_drive_stage: 'token_refresh' | 'token_exchange' | 'api_request';
  google_drive_method: string;
  google_drive_duration_ms: number;
  google_drive_attempts: number;
  google_drive_operation?: string;
  google_drive_request_chars?: number;
  google_drive_request_bytes?: number;
  google_drive_status?: number;
  google_drive_content_type?: string;
  google_drive_response_chars?: number;
  google_drive_error_code?: string;
  google_drive_request_id?: string;
  google_drive_retry_after?: string;
}

export class GoogleDriveRequestError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: GoogleDriveFailureDiagnostics,
  ) {
    super(message);
    this.name = 'GoogleDriveRequestError';
  }
}
