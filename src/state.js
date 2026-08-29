export const BUILD_VERSION = 'deboogs40';

export const state = {
  libraryItemId: '',
  projectName: '',
  projectType: 'unknown',
  entryFile: '',
  files: Object.create(null),
  runtimeErrors: [],
  auditFindings: []
};

export function resetState() {
  state.libraryItemId = '';
  state.projectName = '';
  state.projectType = 'unknown';
  state.entryFile = '';
  state.files = Object.create(null);
  state.runtimeErrors = [];
  state.auditFindings = [];
}
