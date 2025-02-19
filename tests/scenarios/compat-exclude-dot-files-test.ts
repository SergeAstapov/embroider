import type { ExpectFile } from '@embroider/test-support/file-assertions/qunit';
import { expectRewrittenFilesAt } from '@embroider/test-support/file-assertions/qunit';
import { throwOnWarnings } from '@embroider/core';
import type { PreparedApp } from 'scenario-tester';
import CommandWatcher from './helpers/command-watcher';
import { appScenarios, baseAddon } from './scenarios';
import fetch from 'node-fetch';
import QUnit from 'qunit';
import { merge } from 'lodash';
import { setupAuditTest } from '@embroider/test-support/audit-assertions';
const { module: Qmodule, test } = QUnit;

appScenarios
  .map('compat-exclude-dot-files', app => {
    merge(app.files, {
      'ember-cli-build.js': `'use strict';

      const EmberApp = require('ember-cli/lib/broccoli/ember-app');
      const { maybeEmbroider } = require('@embroider/test-setup');

      module.exports = function (defaults) {
        let app = new EmberApp(defaults, {});

        return maybeEmbroider(app);
      };
      `,
      app: {
        '.foobar.js': `// foobar content\nexport {}`,
        '.barbaz.js': `// barbaz content\nexport {}`,
        'bizbiz.js': `// bizbiz content\nexport {}`,
      },
    });

    let addon = baseAddon();
    addon.pkg.name = 'my-addon';
    merge(addon.files, {
      addon: {
        '.fooaddon.js': `// fooaddon content\nexport {}`,
        'baraddon.js': `// bizbiz content\nexport {}`,
      },
    });
    app.addDevDependency(addon);
  })
  .forEachScenario(function (scenario) {
    Qmodule(scenario.name, function (hooks) {
      throwOnWarnings(hooks);

      let app: PreparedApp;
      let server: CommandWatcher;
      let appURL: string;
      let expectFile: ExpectFile;

      hooks.before(async () => {
        app = await scenario.prepare();
        server = CommandWatcher.launch('vite', ['--clearScreen', 'false'], { cwd: app.dir });
        [, appURL] = await server.waitFor(/Local:\s+(https?:\/\/.*)\//g);
      });

      hooks.beforeEach(async assert => {
        expectFile = expectRewrittenFilesAt(app.dir, { qunit: assert });
      });

      hooks.after(async () => {
        await server?.shutdown();
      });

      let expectAudit = setupAuditTest(hooks, () => ({
        appURL,
        startingFrom: ['index.html'],
        fetch: fetch as unknown as typeof globalThis.fetch,
      }));

      test('dot files are not included as app modules', function (assert) {
        // dot files should exist on disk
        expectFile('./app/.foobar.js').exists();
        expectFile('./app/.barbaz.js').exists();
        expectFile('./app/bizbiz.js').exists();

        // but not be picked up in the entrypoint
        expectAudit
          .module('./index.html')
          .resolves(/\/index.html.*/) // in-html app-boot script
          .toModule()
          .resolves(/\/app\.js.*/)
          .toModule()
          .resolves(/.*\/-embroider-entrypoint.js/)
          .toModule()
          .withContents(content => {
            assert.notOk(/app-template\/\.foobar/.test(content), '.foobar is not in the entrypoint');
            assert.notOk(/app-template\/\.barbaz/.test(content), '.barbaz is not in the entrypoint');
            assert.ok(/app-template\/bizbiz/.test(content), 'bizbiz is in the entrypoint');

            // we are relying on the assertinos here so we always return true
            return true;
          });
      });
    });
  });
