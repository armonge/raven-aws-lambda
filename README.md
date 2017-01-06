raven-aws-lambda
===============

This project works as a simple helper to initialize some aws lambda specific information into your raven context


```js
const Raven = require('raven');
const ravenAWSLambda = require('raven-aws-lambda');

Raven.config('YOUR_DNS');
const ravenConfig =  {
  "captureErrors": true,
  "captureTimeoutWarnings": true,
  "captureMemoryWarnings": true
};

exports.handler = function handler(event, context) {
  Raven.context(function () {
    ravenContext =  ravenAWSLambda.init(event, context, ravenConfig);
  });
};
```
