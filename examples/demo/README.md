# @ngsignal/mutation demo

A small Angular app showing `mutation()`, `rxMutation()` and `httpMutation()` through
interactive examples. Each page in the sidebar covers one feature. The API calls are simulated
with a delay ([fake-api.ts](src/app/shared/fake-api.ts),
[fake-http-backend.ts](src/app/shared/fake-http-backend.ts)), so pending states and racing
requests are easy to try.

[Open it on StackBlitz](https://stackblitz.com/github/ngsignal/mutation/tree/main/examples/demo)

## Running it

```bash
cd examples/demo
npm install
npm start
```

Then open `http://localhost:4200`.
