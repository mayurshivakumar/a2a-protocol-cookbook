/**
 * Add request validation in front of DefaultRequestHandler.
 *
 * AgentExecutor failures become failed Tasks by design. Validating before the
 * executor lets malformed A2A input remain a protocol RequestMalformedError.
 */
export function withMessageValidation(requestHandler, validate) {
  return new Proxy(requestHandler, {
    get(target, property, receiver) {
      if (property === 'sendMessage') {
        return async (params, context) => {
          await validate(params.message)
          return target.sendMessage(params, context)
        }
      }

      if (property === 'sendMessageStream') {
        return async function* (params, context) {
          await validate(params.message)
          yield* target.sendMessageStream(params, context)
        }
      }

      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
