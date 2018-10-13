import builtins from 'builtin-modules';
import pkg from './package.json';
import typescript from 'rollup-plugin-typescript2';

const isExternal = pkg => {
  const deps = Object.keys(
    Object.assign(
      {},
      pkg.optionalDependencies || {},
      pkg.peerDependencies || {},
      pkg.dependencies || {},
    ),
  );

  return id => {
    if (id.startsWith('.')) {
      return { result: false, reason: 'starts-with-dot' };
    }

    if (builtins.includes(id)) {
      return { result: true, reason: 'builtin' };
    }

    if (deps.some(dep => dep === id || id.startsWith(dep + '/'))) {
      return { result: true, reason: 'configured-dep' };
    }

    return { result: false, reason: 'fallthrough' };
  };
};

const isPkgExternal = isExternal(pkg);
const external = id => {
  const { result } = isPkgExternal(id);
  return result;
};

module.exports = {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'cjs',
  },
  plugins: [typescript()],
  external,
};
