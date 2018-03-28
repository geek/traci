# traci

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0) [![Build Status](https://secure.travis-ci.org/geek/traci.svg)](http://travis-ci.org/geek/traci)

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
