// Compatibility entry point; built-in plugins now own source registration.
export { getSourceRegistry as getNetworkSources } from '../plugins/runtime'
