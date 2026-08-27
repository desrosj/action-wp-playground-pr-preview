'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ORIGINAL_ENV = { ...process.env };

let mockAgent;
let eventFilePath;

/**
 * Wraps a MockPool so every interceptor a test declares:
 *  - matches a plain string `path` regardless of an appended query string.
 *    Octokit's `github.paginate()` appends `?per_page=100` to the
 *    listComments request, and undici's plain-string path matcher requires
 *    an exact match — it does NOT ignore an unexpected query string, so
 *    without this every paginated GET call fails to match and the mocked
 *    request hangs until the harness's timeout.
 *  - gets a `content-type: application/json` response header automatically.
 *    `MockPool.reply()` does not set one itself, and without it Octokit's
 *    fetch wrapper returns the raw response text instead of parsed JSON —
 *    `response.data` ends up being the *string* `"[]"` instead of an
 *    array, and code like `"total_count" in response.data` (inside
 *    @octokit/plugin-paginate-rest) throws a TypeError on a primitive.
 *
 * Both fixes live here, once, so no individual test has to remember either
 * quirk — every `pool.intercept({ path: '...' }).reply(status, data)` call
 * written elsewhere in this plan works exactly as written.
 */
function wrapPool(pool) {
  const originalIntercept = pool.intercept.bind(pool);
  pool.intercept = (opts) => {
    const matchOpts = { ...opts };
    if (typeof matchOpts.path === 'string') {
      const exact = matchOpts.path;
      matchOpts.path = (requestPath) => requestPath === exact || requestPath.startsWith(`${exact}?`);
    }
    const interceptor = originalIntercept(matchOpts);
    const originalReply = interceptor.reply.bind(interceptor);
    interceptor.reply = (statusCode, data, responseOptions = {}) =>
      originalReply(statusCode, data, {
        ...responseOptions,
        headers: { 'content-type': 'application/json', ...responseOptions.headers },
      });
    return interceptor;
  };
  return pool;
}

/**
 * Resets modules, environment variables, and the mocked GitHub API before
 * each test. Call this from `beforeEach`.
 *
 * @returns {import('undici').MockPool} A mock pool scoped to
 *   https://api.github.com, with real network connections disabled — any
 *   request that isn't explicitly intercepted throws instead of reaching
 *   the network.
 */
function resetHarness() {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  if (eventFilePath && fs.existsSync(eventFilePath)) {
    fs.unlinkSync(eventFilePath);
  }
  eventFilePath = undefined;

  // Required AFTER jest.resetModules(), not at this file's top level.
  // resetModules() clears Jest's per-test-file module registry, so the
  // next require('undici') anywhere (including @actions/github's own
  // internal require when runAction() requires src/index.js fresh) gets a
  // module instance from the same post-reset registry generation. This
  // matters less than the two fixes above, but keeps the dispatcher setup
  // and the module src/index.js actually uses unambiguously in sync.
  const { MockAgent, setGlobalDispatcher } = require('undici');

  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  return wrapPool(mockAgent.get('https://api.github.com'));
}

/**
 * Sets action inputs the way the GitHub Actions runner would: as
 * `INPUT_<NAME>` environment variables. Hyphens in input names are
 * preserved (only spaces become underscores), matching @actions/core's
 * own getInput() implementation.
 *
 * action.yml's declared defaults are applied by the real Actions runner,
 * not by getInput() — set every input a test relies on explicitly, even
 * ones with a default in action.yml.
 *
 * @param {Record<string, string>} inputs
 */
function setInputs(inputs) {
  for (const [name, value] of Object.entries(inputs)) {
    if (value === undefined) continue;
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = String(value);
  }
}

/**
 * Writes a fake `pull_request` event payload to a temp file and points
 * GITHUB_EVENT_PATH at it, so @actions/github's `context.payload` is
 * populated the way it would be inside a real workflow run.
 *
 * @param {{pull_request?: object, repository?: object}} payload
 */
function setEventPayload(payload) {
  eventFilePath = path.join(
    os.tmpdir(),
    `event-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(eventFilePath, JSON.stringify(payload));
  process.env.GITHUB_EVENT_PATH = eventFilePath;
}

/**
 * Requires src/index.js fresh (it runs immediately on require — it's a
 * top-level self-invoking script with no exports) and waits for every
 * mocked GitHub API call registered on the harness's MockPool to be
 * consumed before returning.
 *
 * @param {number} [timeoutMs]
 */
async function runAction(timeoutMs = 2000) {
  require('../../src/index.js');

  const start = Date.now();
  while (mockAgent.pendingInterceptors().length > 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for mocked GitHub API calls to complete. ` +
          `Still pending: ${JSON.stringify(mockAgent.pendingInterceptors())}`,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  // One more tick so any work after the last awaited call (e.g. core.setOutput)
  // has a chance to run before the test asserts.
  await new Promise((resolve) => setImmediate(resolve));
}

module.exports = { resetHarness, setInputs, setEventPayload, runAction };
