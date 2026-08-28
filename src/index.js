const core = require('@actions/core');
const githubLib = require('@actions/github');
const { mergeVariables, substitute } = require('./templates');
const { normalizePath, sanitizeSlug, inferSlug, buildAutoBlueprint } = require('./blueprint');
const { performDescriptionUpdate, removeManagedDescriptionBlock } = require('./description');
const { performCommentUpdate } = require('./comment');

(async () => {
  const context = githubLib.context;
  const githubToken = core.getInput('github-token', {required: false});
  if (!githubToken) {
    throw new Error('GITHUB_TOKEN (or github-token input) is required to call the GitHub API.');
  }
  const github = githubLib.getOctokit(githubToken);
  const mode = (core.getInput('mode', {required: false}) || '').trim().toLowerCase();
  if (mode !== 'append-to-description' && mode !== 'comment') {
    throw new Error(`Invalid preview mode: ${mode}. Accepted values: append-to-description, comment.`);
  }

  // Accept data from both context and inputs
  const prNumberInput = core.getInput('pr-number', {required: false});

  let pr = context.payload.pull_request;
  let repo = context.payload.repository;

  // If pr-number is provided as input, fetch PR details from GitHub API
  if (prNumberInput) {
    const prNumber = parseInt(prNumberInput, 10);
    core.info(`Fetching PR #${prNumber} details from GitHub API...`);

    // Get repo info from context or use current repo
    const owner = repo ? (repo.owner.login || repo.owner.name || repo.owner.id) : context.repo.owner;
    const repoName = repo ? repo.name : context.repo.repo;

    try {
      const {data: prData} = await github.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

      // Replace pr and repo with fetched data
      pr = prData;
      if (!repo) {
        repo = prData.base.repo;
      }
      core.info(`Successfully fetched PR #${prNumber}: "${prData.title}"`);
    } catch (error) {
      throw new Error(`Failed to fetch PR #${prNumber}: ${error.message}`);
    }
  }

  // Validate we have PR data from either context or API
  if (!pr) {
    throw new Error('This workflow must run on a pull_request event payload, or pr-number must be provided as input.');
  }

  const owner = repo.owner.login || repo.owner.name || repo.owner.id;
  const repoName = repo.name;
  const repoFullName = repo.full_name;
  const prNumber = pr.number;
  const prTitle = pr.title;
  const headRef = pr.head.ref;
  const headSha = pr.head.sha;
  const baseRef = pr.base.ref;

  const playgroundHostRaw = core.getInput('playground-host', {required: false}) || 'https://playground.wordpress.net';
  const playgroundHost = playgroundHostRaw.replace(/\/+$/, '');

  const pluginPath = (core.getInput('plugin-path', {required: false}) || '').trim();
  const themePath = (core.getInput('theme-path', {required: false}) || '').trim();
  const blueprintInput = core.getInput('blueprint', {required: false}) || '';
  const blueprintUrlInput = (core.getInput('blueprint-url', {required: false}) || '').trim();

  if(!pluginPath && !themePath && !blueprintInput && !blueprintUrlInput) {
    throw new Error('One of `plugin-path`, `theme-path`, `blueprint`, or `blueprint-url` inputs is required.');
  }

  const descriptionTemplateInput = core.getInput('description-template', {required: false}) || '';
  const commentTemplateInput = core.getInput('comment-template', {required: false}) || '';
  const commentIdentifier = '<!-- wp-playground-preview-comment -->';
  const restoreButtonIfRemoved = core.getInput('restore-button-if-removed', {required: false}) !== 'false';

  const safeParseJson = (label, value, fallback = {}) => {
    if (!value || !value.trim()) {
  	return fallback;
    }
    try {
  	return JSON.parse(value);
    } catch (error) {
  	throw new Error(`Unable to parse ${label} as JSON. ${error.message}`);
    }
  };

  const archiveBranchSegment = headRef.replace(/[^0-9A-Za-z]/g, '-');
  const repoArchiveRoot = `${repoName}-${archiveBranchSegment}`;
  const repoGitUrl = `https://github.com/${repoFullName}.git`;

  const repoSlug = sanitizeSlug(repoName, 'project');

  const pluginSlug = pluginPath ? inferSlug(pluginPath, repoSlug) : '';
  const themeSlug = themePath ? inferSlug(themePath, `${repoSlug}-theme`) : '';

  let blueprintJson = '';
  if (blueprintInput && blueprintInput.trim().length) {
    blueprintJson = blueprintInput.trim();
  } else if (pluginPath || themePath) {
    blueprintJson = buildAutoBlueprint({ pluginPath, themePath, repoGitUrl, headRef });
  }

  if (blueprintJson) {
    try {
      JSON.parse(blueprintJson);
    } catch (error) {
      core.warning(blueprintJson);
      throw new Error(`Blueprint is not valid JSON. ${error.message}`);
    }
  }


  const blueprintDataUrl = blueprintJson
    ? `data:application/json,${encodeURIComponent(blueprintJson)}`
    : '';
  const finalBlueprintUrl = blueprintUrlInput || blueprintDataUrl;
  const blueprintQueryValue = blueprintUrlInput
    ? encodeURIComponent(blueprintUrlInput)
    : blueprintDataUrl;
  const previewUrl = `${playgroundHost}${playgroundHost.includes('?') ? '&' : '?'}blueprint-url=${blueprintQueryValue}`;

  const joinWithNewline = (segments) => segments.join('\n');
  const defaultButtonImageUrl = 'https://raw.githubusercontent.com/adamziel/playground-preview/refs/heads/trunk/assets/playground-preview-button.svg';

  const defaultButtonTemplate = joinWithNewline([
    '<a href="{{PLAYGROUND_URL}}" target="_blank" rel="noopener noreferrer">',
    '  <img src="{{PLAYGROUND_BUTTON_IMAGE_URL}}" alt="Open WordPress Playground Preview" width="220" height="57" />',
    '</a>'
  ]);

  const defaultDescriptionTemplate = joinWithNewline([
    '{{PLAYGROUND_BUTTON}}',
  ]);

  const defaultCommentTemplate = joinWithNewline([
    '### WordPress Playground Preview',
    '',
    'The changes in this pull request can previewed and tested using a WordPress Playground instance.',
    '',
    '{{PLAYGROUND_BUTTON}}',
  ]);

  const baseTemplateVars = {
    PR_NUMBER: String(prNumber),
    PR_TITLE: prTitle,
    PR_HEAD_REF: headRef,
    PR_HEAD_SHA: headSha,
    PR_BASE_REF: baseRef,
    REPO_OWNER: owner,
    REPO_NAME: repoName,
    REPO_FULL_NAME: repoFullName,
    REPO_ARCHIVE_ROOT: repoArchiveRoot,
    REPO_SLUG: repoSlug,
    PLUGIN_PATH: pluginPath,
    THEME_PATH: themePath,
    PLUGIN_SLUG: pluginSlug,
    THEME_SLUG: themeSlug,
    PLAYGROUND_HOST: playgroundHost
  };

  const templateVariables = mergeVariables(
    baseTemplateVars,
    {
  	PLAYGROUND_URL: previewUrl,
  	PLAYGROUND_BLUEPRINT_JSON: blueprintJson,
  	PLAYGROUND_BLUEPRINT_DATA_URL: finalBlueprintUrl,
  	PLAYGROUND_BUTTON_IMAGE_URL: defaultButtonImageUrl,
  	PLAYGROUND_BUTTON: substitute(defaultButtonTemplate, {})
    }
  );

  templateVariables.PLAYGROUND_BUTTON = substitute(defaultButtonTemplate, templateVariables);

  const descriptionTemplate = descriptionTemplateInput && descriptionTemplateInput.trim().length
    ? descriptionTemplateInput
    : defaultDescriptionTemplate;
  const commentTemplate = commentTemplateInput && commentTemplateInput.trim().length
    ? commentTemplateInput
    : defaultCommentTemplate;

  const renderedDescription = substitute(descriptionTemplate, templateVariables);
  const renderedComment = substitute(commentTemplate, templateVariables);


  let commentId = '';
  if (mode === 'append-to-description') {
    await performDescriptionUpdate({
      github,
      owner,
      repoName,
      prNumber,
      currentBody: pr.body || '',
      renderedDescription,
      restoreButtonIfRemoved,
    });
  } else {
    await removeManagedDescriptionBlock({ github, owner, repoName, prNumber, currentBody: pr.body || '' });
    commentId = String(
      (await performCommentUpdate({ github, owner, repoName, prNumber, commentIdentifier, renderedComment })) || '',
    );
  }

  core.setOutput('mode', mode);
  core.setOutput('preview-url', previewUrl);
  core.setOutput('blueprint-json', blueprintJson);
  core.setOutput('rendered-description', renderedDescription);
  core.setOutput('rendered-comment', renderedComment);
  core.setOutput('comment-id', commentId);
})().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
