import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

const workflow = readFileSync('.github/workflows/links.yml', 'utf8').replaceAll(
  '\r\n',
  '\n'
);

function getStepBlock(stepName) {
  const lines = workflow.split('\n');
  const header = `      - name: ${stepName}`;
  const start = lines.findIndex((line) => line === header);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('      - ')
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

describe('offline repository link workflow', () => {
  it('fails for every nonzero local link validation exit', () => {
    const failureStep = getStepBlock('Fail if broken links were found');
    expect(failureStep).toContain('!cancelled()');
    expect(failureStep).toContain('steps.lychee.outputs.exit_code != 0');
    expect(failureStep).not.toContain('all_recovered');
    expect(failureStep).not.toContain('all_archived');
    expect(failureStep).toContain('Broken repository links were detected.');
  });

  it('never re-requests historical URLs outside collector security and pacing guards', () => {
    const checker = getStepBlock('Check links with lychee');
    expect(checker).toContain('--offline');
    expect(getStepBlock('Re-check transient link failures')).toBe('');
    expect(getStepBlock('Check broken links against Web Archive')).toBe('');
    expect(checker).not.toContain('GITHUB_TOKEN');
  });

  it('keeps captured source pages out of authored-document validation', () => {
    const checker = getStepBlock('Check links with lychee');
    expect(checker).toContain('--exclude-path docs/acceptance');
    expect(checker).toContain('--exclude-path data/cases');
    expect(checker).toContain('--exclude-path tests/fixtures');
    expect(checker).toContain('./**/*.md');
    expect(checker).toContain('./**/*.html');
  });

  it('triggers on changes to link-validation policy and regression assertions', () => {
    for (const trigger of ['push', 'pull_request']) {
      const start = workflow.indexOf(`  ${trigger}:`);
      const end = workflow.indexOf('  workflow_dispatch:', start);
      const triggerBlock = workflow.slice(start, end);
      for (const path of [
        '.github/workflows/links.yml',
        '.lycheeignore',
        'tests/links-workflow.test.js',
      ]) {
        expect(triggerBlock).toContain(`- '${path}'`);
      }
    }
  });
});
