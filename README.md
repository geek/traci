# traci

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0) [![Build Status](https://secure.travis-ci.org/geek/traci.svg)](http://travis-ci.org/geek/traci)

hapi open tracing plugin


## Options

- `tracer` - instance of OpenTracing.Tracer, defaults to OpenTracing.Tracer base class
- `onRequest` - array of properties to select from the hapi `request` object and include in the hapi_request span log. Defaults to `['headers', 'info']`
- `onPostAuth` - array of properties to select from the hapi `request` object and include in the hapi_auth span log. Defaults to `['auth']`
- `onPreHandler` - array of properties to select from the hapi `request` object and include in the hapi_handler span log. Defaults to `['route.settings.handler.name']`
- `onPreResponse` - array of properties to select from the hapi `request` object and include in the hapi_response span log. Defaults to `['info']`


## Properties

Decorates the hapi server object with `.tracer`, which is an instance of the intialized Tracer class. This can be used to create spans and reports. To access a parent span of one of the following types you can use the new `request.span(type)` method to return the current span of whatever type you care about. For example, to create a new span in a request handler using the parent handler span you can invoke `request.span` as follows:

```js
handler: (request, h) => {
  const span = request.server.tracer.startSpan('some_action', { childOf: request.span('handler').context() });
  const something = await someAction();
  span.finish();
  return something;
}
```

The following spans are created:

- `hapi_request`
- `hapi_auth`
- `hapi_handler`
- `hapi_response`
- `hapi_log`

Inside of a handler you can obtain the parent span by invoking `request.span()`
