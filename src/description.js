'use strict';

const DESCRIPTION_MARKER_START = '<!-- wp-playground-preview:start -->';
const DESCRIPTION_MARKER_END = '<!-- wp-playground-preview:end -->';

async function performDescriptionUpdate({
  github,
  owner,
  repoName,
  prNumber,
  currentBody,
  renderedDescription,
  restoreButtonIfRemoved,
}) {
  const managedBlock = `${DESCRIPTION_MARKER_START}\n${renderedDescription.trim()}\n${DESCRIPTION_MARKER_END}`;
  let nextBody;

  if (currentBody.includes(DESCRIPTION_MARKER_START) && currentBody.includes(DESCRIPTION_MARKER_END)) {
    const pattern = new RegExp(`${DESCRIPTION_MARKER_START}([\\s\\S]*?)${DESCRIPTION_MARKER_END}`, 'm');
    const match = currentBody.match(pattern);
    if (match) {
      const existingContent = match[1].trim();
      const looksLikeButton = existingContent.includes('<a ') && existingContent.includes('playground');
      if (existingContent && !looksLikeButton) {
        return;
      }
    }
    nextBody = currentBody.replace(pattern, managedBlock);
  } else {
    if (!restoreButtonIfRemoved) {
      return;
    }
    const trimmed = currentBody.trimEnd();
    nextBody = trimmed ? `${trimmed}\n\n${managedBlock}` : managedBlock;
  }

  if (nextBody !== currentBody) {
    await github.rest.pulls.update({ owner, repo: repoName, pull_number: prNumber, body: nextBody });
  }
}

async function removeManagedDescriptionBlock({ github, owner, repoName, prNumber, currentBody }) {
  if (!currentBody.includes(DESCRIPTION_MARKER_START) || !currentBody.includes(DESCRIPTION_MARKER_END)) {
    return;
  }

  const pattern = new RegExp(`${DESCRIPTION_MARKER_START}[\\s\\S]*?${DESCRIPTION_MARKER_END}\\s*`, 'm');
  const nextBody = currentBody.replace(pattern, '').trimEnd();

  if (nextBody !== currentBody) {
    await github.rest.pulls.update({ owner, repo: repoName, pull_number: prNumber, body: nextBody });
  }
}

module.exports = { DESCRIPTION_MARKER_START, DESCRIPTION_MARKER_END, performDescriptionUpdate, removeManagedDescriptionBlock };
