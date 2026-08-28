export const BUILD_VERSION = 'deboogs7';

export const state = {
  projectName: '',
  projectType: 'unknown',
  entryFile: '',
  files: Object.create(null),
  runtimeErrors: [],
  auditFindings: []
};

export function resetState() {
  state.projectName = '';
  state.projectType = 'unknown';
  state.entryFile = '';
  state.files = Object.create(null);
  state.runtimeErrors = [];
  state.auditFindings = [];
}
