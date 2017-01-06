'use strict';

const Raven = require('raven');
const _ = require('lodash');

module.exports.init = function init(event, context, ravenConfig) {
  let memoryWatch;
  let timeoutWarning;
  let timeoutError;

  const done = context.done;

  context.done = sentryWrapCb(done);
  context.fail = function fail(err) {
    context.done(err);
  };

  context.succeed = function succeed(data) {
    context.done(null, data);
  };

  Raven.mergeContext({ extra: { event: _.cloneDeep(event) } });
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    Raven.mergeContext({
      tags: {
        Lambda: process.env.AWS_LAMBDA_FUNCTION_NAME,
        Version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
        LogStream: process.env.AWS_LAMBDA_LOG_STREAM_NAME,
      },
    });
    startWatches(Raven, context);
  }

  return context;

  function sentryWrapCb(cb) {
    return function sentryCallbackWrapper(err, data) {
      // Clear all timeouts before finishing the function
      clearTimers();

      if (err && (ravenConfig.captureErrors || err.domainThrown)) {
        captureError(err, () => {
          cb(err, data);
        });
      } else {
        cb(err, data);
      }
    };
  }

  // Captures an error and waits for it to be logged in Sentry
  function captureError(err, cb) {
    function onCaptured() {
      Raven.removeListener('logged', onCaptured);
      Raven.removeListener('error', onCaptured);
      return cb();
    }

    Raven.on('logged', onCaptured);
    Raven.on('error', onCaptured);
    if (err instanceof Error) {
      Raven.captureException(err);
    } else {
      Raven.captureMessage(err, { level: 'error' });
    }
  }

  function clearTimers() {
    if (timeoutWarning) {
      clearTimeout(timeoutWarning);
      timeoutWarning = null;
    }

    if (timeoutError) {
      clearTimeout(timeoutError);
      timeoutError = null;
    }

    if (memoryWatch) {
      clearTimeout(memoryWatch);
      memoryWatch = null;
    }
  }

  function startWatches() {
    const timeRemaining = context.getRemainingTimeInMillis();
    const memoryLimit = context.memoryLimitInMB;

    if (ravenConfig.captureTimeoutWarnings) {
      // We schedule the warning at half the maximum execution time and
      // the error a few milliseconds before the actual timeout happens.
      timeoutWarning = setTimeout(timeoutWarningFunc, timeRemaining / 2);
      timeoutError = setTimeout(timeoutErrorFunc, Math.max(timeRemaining - 500, 0));
    }

    if (ravenConfig.captureMemoryWarnings) {
      // Schedule memory watch dog interval. Note that we're not using
      // setInterval() here as we don't want invokes to be skipped.
      memoryWatch = setTimeout(memoryWatchFunc, 500);
    }

    function timeoutWarningFunc() {
      const elapsedSeconds = (Math.ceil(timeRemaining / 1000) / 2.0);
      Raven.captureMessage(`Execution Time Exceeds ${elapsedSeconds} seconds`, {
        level: 'warning',
        extra: {
          TimeRemainingInMsec: context.getRemainingTimeInMillis(),
        },
      });
    }

    function memoryWatchFunc() {
      const used = process.memoryUsage().rss / 1048576;
      const p = (used / memoryLimit);
      if (p >= 0.75) {
        Raven.captureMessage('Low Memory Warning', {
          level: 'warning',
          extra: {
            MemoryLimitInMB: memoryLimit,
            MemoryUsedInMB: Math.floor(used),
          },
        });

        if (memoryWatch) {
          clearTimeout(memoryWatch);
          memoryWatch = null;
        }
      } else {
        memoryWatch = setTimeout(memoryWatchFunc, 500);
      }
    }

    function timeoutErrorFunc() {
      Raven.captureMessage('Function Timed Out', {
        level: 'error',
      });
    }
  }
};
