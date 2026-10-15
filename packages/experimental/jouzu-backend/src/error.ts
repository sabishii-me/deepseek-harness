/** Failures with stable handling categories; never infer retry safety from text. */
export class JouzuError extends Error {
  constructor(
    readonly code: 'POLICY' | 'PROTOCOL' | 'CLOSED' | 'TIMEOUT' | 'LIMIT' | 'REMOTE' | 'CONSUMER',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'JouzuError'
  }
}
