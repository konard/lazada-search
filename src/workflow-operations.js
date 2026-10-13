import {
  planCaseWorkflow,
  runCaseWorkflow,
  caseWorkflowStatus,
} from './case-workflow.js';
import {
  planManufacturerWorkflow,
  runManufacturerWorkflow,
  manufacturerWorkflowStatus,
} from './manufacturer-workflow.js';
import {
  prepareManufacturerWorkflowReview,
  reviewManufacturerWorkflow,
} from './manufacturer-workflow-review.js';
import { createManufacturerSearchProvider } from './manufacturer-workflow-search.js';
import { buildLabelWorklist } from './label-worklist.js';
import {
  importLazadaCheckoutSnapshot,
  lazadaCheckoutAdapterStatus,
} from './lazada-checkout-adapter.js';
import { capturePreparedLazadaCheckout } from './lazada-checkout-capture.js';
import {
  prepareLazadaCheckoutScenario,
  runPreparedLazadaCheckoutScenarios,
} from './lazada-checkout-actions.js';
import {
  importLazadaCheckoutFoodGiftDiscovery,
  acquireLazadaCheckoutFoodGifts,
} from './lazada-checkout-gifts.js';
import {
  importCaseInventoryManifest,
  recordCaseManualReview,
  caseCoverageStatus,
} from './case-coverage.js';
import {
  registerHandpickedLinks,
  resolveHandpickedLinks,
  handpickedLinkStatus,
} from './handpicked-links.js';
import { buildShoppingReport, saveShoppingReport } from './shopping-report.js';
import { requirementDraftStatus } from './requirement-registry.js';
import { caseReadiness } from './case-readiness.js';

export const WORKFLOW_OPERATION_NAMES = [
  'plan-case-workflow',
  'run-case-workflow',
  'case-workflow-status',
  'plan-manufacturer-workflow',
  'run-manufacturer-workflow',
  'manufacturer-workflow-status',
  'prepare-manufacturer-workflow-review',
  'review-manufacturer-workflow',
  'label-worklist',
  'import-lazada-checkout',
  'capture-lazada-checkout',
  'lazada-checkout-status',
  'prepare-lazada-checkout-scenario',
  'run-lazada-checkout-scenarios',
  'discover-lazada-food-gifts',
  'acquire-lazada-food-gifts',
  'import-case-inventory',
  'record-case-manual-review',
  'case-coverage-status',
  'register-handpicked-links',
  'resolve-handpicked-links',
  'handpicked-link-status',
  'shopping-report',
  'requirement-draft-status',
  'case-readiness',
];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} needs an object`);
  }
  return value;
}

function workflowId(input) {
  if (typeof input.workflowId !== 'string' || !input.workflowId) {
    throw new Error('Workflow ID is required');
  }
  return input.workflowId;
}

export function executeWorkflowOperation(
  application,
  operation,
  input = {},
  options = {}
) {
  const handlers = {
    'plan-case-workflow': () =>
      planCaseWorkflow(application, object(input.plan, 'Case plan')),
    'run-case-workflow': () =>
      runCaseWorkflow(application, workflowId(input), options),
    'case-workflow-status': () =>
      caseWorkflowStatus(application, workflowId(input)),
    'plan-manufacturer-workflow': () =>
      planManufacturerWorkflow(application, input.plan || options),
    'run-manufacturer-workflow': () =>
      runManufacturerWorkflow(application, workflowId(input), {
        ...options,
        searchProvider:
          options.searchProvider ||
          application.manufacturerSearchProvider ||
          (options.searchConfiguration
            ? createManufacturerSearchProvider(
                application,
                options.searchConfiguration
              )
            : undefined),
      }),
    'manufacturer-workflow-status': () =>
      manufacturerWorkflowStatus(application, workflowId(input)),
    'prepare-manufacturer-workflow-review': () =>
      prepareManufacturerWorkflowReview(
        application,
        object(input.request, 'Manufacturer review packet request')
      ),
    'review-manufacturer-workflow': () =>
      reviewManufacturerWorkflow(
        application,
        object(input.review, 'Human manufacturer source review')
      ),
    'label-worklist': () => buildLabelWorklist(application, options),
    'import-lazada-checkout': () =>
      importLazadaCheckoutSnapshot(
        application,
        object(input.capture, 'Prepared checkout original')
      ),
    'capture-lazada-checkout': () =>
      capturePreparedLazadaCheckout(
        application,
        object(input.capture, 'Reviewed checkout layout')
      ),
    'lazada-checkout-status': () =>
      lazadaCheckoutAdapterStatus(application, input),
    'prepare-lazada-checkout-scenario': () =>
      prepareLazadaCheckoutScenario(
        application,
        object(input.scenario, 'Prepared scenario')
      ),
    'run-lazada-checkout-scenarios': () =>
      runPreparedLazadaCheckoutScenarios(
        application,
        object(input.sweep, 'Prepared scenario sweep')
      ),
    'discover-lazada-food-gifts': () =>
      importLazadaCheckoutFoodGiftDiscovery(
        application,
        object(input.discovery, 'Food gift discovery')
      ),
    'acquire-lazada-food-gifts': () =>
      acquireLazadaCheckoutFoodGifts(
        application,
        object(input.review, 'Food gift source review')
      ),
    'import-case-inventory': () =>
      importCaseInventoryManifest(
        application,
        object(input.inventory, 'Inventory original mapping')
      ),
    'record-case-manual-review': () =>
      recordCaseManualReview(
        application,
        object(input.review, 'Manual source review')
      ),
    'case-coverage-status': () => caseCoverageStatus(application, input),
    'register-handpicked-links': () =>
      registerHandpickedLinks(
        application,
        object(input.links, 'Handpicked links')
      ),
    'resolve-handpicked-links': () =>
      resolveHandpickedLinks(application, options),
    'handpicked-link-status': () => handpickedLinkStatus(application),
    'shopping-report': async () => {
      const report = await buildShoppingReport(application, options);
      return options.persist === true
        ? saveShoppingReport(application, report)
        : report;
    },
    'requirement-draft-status': () => requirementDraftStatus(),
    'case-readiness': () => caseReadiness(application, input),
  };
  if (!Object.hasOwn(handlers, operation)) {
    throw new Error('Unsupported draft workflow operation');
  }
  return handlers[operation]();
}
