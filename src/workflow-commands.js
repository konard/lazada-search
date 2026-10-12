import { readFile } from 'node:fs/promises';
import {
  WORKFLOW_OPERATION_NAMES,
  executeWorkflowOperation,
} from './workflow-operations.js';
import { createManufacturerSearchProvider } from './manufacturer-workflow-search.js';

export { WORKFLOW_OPERATION_NAMES };

const required = (value, label) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
};
const read = async (path) =>
  JSON.parse(await readFile(required(path, 'JSON file'), 'utf8'));

export async function executeWorkflowCommand(
  application,
  command,
  args,
  options = {}
) {
  const fileInputs = {
    'plan-case-workflow': 'plan',
    'plan-manufacturer-workflow': 'plan',
    'prepare-manufacturer-workflow-review': 'request',
    'review-manufacturer-workflow': 'review',
    'import-lazada-checkout': 'capture',
    'capture-lazada-checkout': 'capture',
    'prepare-lazada-checkout-scenario': 'scenario',
    'run-lazada-checkout-scenarios': 'sweep',
    'discover-lazada-food-gifts': 'discovery',
    'acquire-lazada-food-gifts': 'review',
    'import-case-inventory': 'inventory',
    'record-case-manual-review': 'review',
    'register-handpicked-links': 'links',
  };
  if (Object.hasOwn(fileInputs, command)) {
    return executeWorkflowOperation(
      application,
      command,
      { [fileInputs[command]]: await read(args[0]) },
      options
    );
  }
  if (['run-case-workflow', 'run-manufacturer-workflow'].includes(command)) {
    const runtime = args[1] ? await read(args[1]) : {};
    if (runtime.searchConfiguration) {
      runtime.searchProvider = createManufacturerSearchProvider(
        application,
        runtime.searchConfiguration
      );
      delete runtime.searchConfiguration;
    }
    return executeWorkflowOperation(
      application,
      command,
      {
        workflowId: required(args[0], 'Workflow ID'),
      },
      { ...options, ...runtime }
    );
  }
  if (
    ['case-workflow-status', 'manufacturer-workflow-status'].includes(command)
  ) {
    return executeWorkflowOperation(
      application,
      command,
      { workflowId: required(args[0], 'Workflow ID') },
      options
    );
  }
  const input = args[0] ? await read(args[0]) : {};
  return executeWorkflowOperation(application, command, input, {
    ...options,
    ...(input.options || {}),
  });
}
