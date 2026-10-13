import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';

if (process.platform === 'win32') {
  test('the real Windows OCR setup retries the same pin, stops on success and fails after exhaustion or a missing executable', async () => {
    const workflow = parse(
      await readFile('.github/workflows/release.yml', 'utf8')
    );
    const body = workflow.jobs.test.steps.find(
      (step) => step.name === 'Install native OCR (Windows)'
    ).run;
    const scenarios = [
      { exits: [0], calls: 1, delays: [], success: true, executable: true },
      {
        exits: [1, 1, 0],
        calls: 3,
        delays: [10, 20],
        success: true,
        executable: true,
      },
      {
        exits: [1, 1, 1],
        calls: 3,
        delays: [10, 20],
        success: false,
        executable: true,
      },
      {
        exits: [0],
        calls: 1,
        delays: [],
        success: false,
        executable: false,
      },
    ];
    for (const scenario of scenarios) {
      // External commands are local fault adapters; the actual workflow body
      // runs unchanged without installing packages or writing runner paths.
      const script = `
        $ErrorActionPreference = 'Stop'
        $script:ocrExits = @(${scenario.exits.join(',')})
        $script:ocrArguments = @()
        $script:ocrDelays = @()
        $script:ocrPaths = @()
        $script:ocrCalls = 0
        function choco {
          $script:ocrArguments += ,@($args)
          $global:LASTEXITCODE = $script:ocrExits[$script:ocrCalls]
          $script:ocrCalls++
        }
        function Start-Sleep {
          param([int] $Seconds)
          $script:ocrDelays += $Seconds
        }
        function Test-Path { return $${scenario.executable} }
        function Out-File {
          param(
            [Parameter(ValueFromPipeline = $true)] [string] $InputObject,
            [string] $FilePath, [string] $Encoding, [switch] $Append
          )
          process { $script:ocrPaths += $InputObject }
        }
        $ocrSucceeded = $false
        $ocrError = $null
        try {
          & {
            ${body}
          }
          $ocrSucceeded = $true
        } catch { $ocrError = $_.Exception.Message }
        [PSCustomObject]@{
          calls = $script:ocrCalls
          arguments = @($script:ocrArguments)
          delays = @($script:ocrDelays)
          paths = @($script:ocrPaths)
          success = $ocrSucceeded
          error = $ocrError
        } | ConvertTo-Json -Compress -Depth 5
      `;
      const { stdout } = await promisify(execFile)(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 15000 }
      );
      const receipt = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
      assert.equal(receipt.calls, scenario.calls);
      assert.deepEqual(receipt.delays, scenario.delays);
      assert.equal(receipt.success, scenario.success);
      assert.equal(receipt.paths.length, scenario.success ? 1 : 0);
      for (const args of receipt.arguments) {
        assert.deepEqual(args, [
          'install',
          'tesseract',
          '--version=5.5.3.20260724',
          '--yes',
          '--no-progress',
        ]);
      }
      if (!scenario.success) {
        assert.match(
          receipt.error,
          scenario.executable
            ? /installation failed with exit 1/u
            : /Installed Tesseract executable is missing/u
        );
      }
    }
  });
}
