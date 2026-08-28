export const BUILD_VERSION = 'deboogs5';

export const state = {
  projectName: '',
  projectType: 'unknown',
  entryFile: '',
  files: Object.create(null),
  runtimeErrors: []
};

export function resetState() {
  state.projectName = '';
  state.projectType = 'unknown';
  state.entryFile = '';
  state.files = Object.create(null);
  state.runtimeErrors = [];
}
