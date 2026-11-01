export class HttpAuthenticationError extends Error {
  constructor(message = 'Authentication required', challenge = 'Bearer') {
    super(message)
    this.name = 'HttpAuthenticationError'
    this.statusCode = 401
    this.challenge = challenge
  }
}
