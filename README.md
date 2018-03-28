# traci
hapi open tracing plugin


## Options

- `tracer` - instance of OpenTracing.Tracer, defaults to OpenTracing.Tracer base class

## Properties

Decorates the hapi server object with `.tracer`, which is an instance of the intialized Tracer class. This can be used to create spans and reports.

The following spans are created:

- `hapi_request`
- `hapi_auth`
- `hapi_handler`
- `hapi_response`
- `hapi_log`
