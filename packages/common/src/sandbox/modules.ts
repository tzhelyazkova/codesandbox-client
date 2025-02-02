// @flow
import { Module, Directory } from '../types';
import { memoize } from 'lodash-es';

const compareTitle = (
  original: string,
  test: string,
  ignoredExtensions: Array<string>
) => {
  if (original === test) return true;

  return ignoredExtensions.some(ext => original === `${test}.${ext}`);
};

const throwError = (path: string) => {
  throw new Error(`Cannot find module in ${path}`);
};

export function resolveDirectory(
  _path: string | undefined,
  modules: Array<Module>,
  directories: Array<Directory>,
  _startdirectoryShortid: string | undefined = undefined
) {
  if (!_path) return throwError('');

  let path = _path;
  let startdirectoryShortid = _startdirectoryShortid;
  // If paths start with {{sandboxRoot}} we see them as root paths
  if (path.startsWith('{{sandboxRoot}}')) {
    startdirectoryShortid = undefined;
    path = _path.replace('{{sandboxRoot}}/', './');
  }

  // Split path
  const splitPath = path
    .replace(/^.\//, '')
    .split('/')
    .filter(Boolean);

  const foundDirectoryShortid = splitPath.reduce(
    (dirId: string | undefined, pathPart: string, i: number) => {
      // Meaning this is the last argument, so the directory
      if (i === splitPath.length) return dirId;

      if (pathPart === '..') {
        // Find the parent
        const dir = directories.find(d => d.shortid === dirId);
        if (dir == null) throwError(path);

        return dir.directoryShortid;
      }

      const directoriesInDirectory = directories.filter(
        // eslint-disable-next-line eqeqeq
        m => m.directoryShortid == dirId
      );

      const nextDirectory = directoriesInDirectory.find(d =>
        compareTitle(d.title, pathPart, [])
      );

      if (nextDirectory == null) throwError(path);

      return nextDirectory.shortid;
    },
    startdirectoryShortid
  );

  return directories.find(d => d.shortid === foundDirectoryShortid);
}

export function getModulesInDirectory(
  _path: string | undefined,
  modules: Array<Module>,
  directories: Array<Directory>,
  _startdirectoryShortid: string | undefined = undefined
) {
  if (!_path) return throwError('');

  let path = _path;
  // If paths start with {{sandboxRoot}} we see them as root paths
  if (path.startsWith('{{sandboxRoot}}')) {
    path = _path.replace('{{sandboxRoot}}/', './');
  }

  // Split path
  const splitPath = path
    .replace(/^.\//, '')
    .split('/')
    .filter(Boolean);

  const dirPath = path
    .replace(/^.\//, '')
    .split('/')
    .filter(Boolean);
  dirPath.pop();

  const dir = resolveDirectory(
    dirPath.join('/') || '/',
    modules,
    directories,
    _startdirectoryShortid
  );
  const foundDirectoryShortid = dir ? dir.shortid : null;

  const lastPath = splitPath[splitPath.length - 1];
  const modulesInFoundDirectory = modules.filter(
    // eslint-disable-next-line eqeqeq
    m => m.directoryShortid == foundDirectoryShortid
  );

  return {
    modules: modulesInFoundDirectory,
    foundDirectoryShortid,
    lastPath,
    splitPath,
  };
}

/**
 * Convert the module path to a module
 */
export const resolveModule = (
  path: string | undefined,
  modules: Array<Module>,
  directories: Array<Directory>,
  startdirectoryShortid: string | undefined = undefined,
  ignoredExtensions: Array<string> = ['js', 'jsx', 'json']
): Module => {
  const {
    modules: modulesInFoundDirectory,
    lastPath,
    splitPath,
    foundDirectoryShortid,
  } = getModulesInDirectory(path, modules, directories, startdirectoryShortid);

  // Find module with same name
  const foundModule = modulesInFoundDirectory.find(m =>
    compareTitle(m.title, lastPath, ignoredExtensions)
  );
  if (foundModule) return foundModule;

  // Check all directories in said directory for same name
  const directoriesInFoundDirectory = directories.filter(
    // eslint-disable-next-line eqeqeq
    m => m.directoryShortid == foundDirectoryShortid
  );
  const foundDirectory = directoriesInFoundDirectory.find(m =>
    compareTitle(m.title, lastPath, ignoredExtensions)
  );

  // If it refers to a directory
  if (foundDirectory) {
    // Find module named index
    const indexModule = modules.find(
      m =>
        // eslint-disable-next-line eqeqeq
        m.directoryShortid == foundDirectory.shortid &&
        compareTitle(m.title, 'index', ignoredExtensions)
    );
    if (indexModule == null) throwError(path);
    return indexModule;
  }

  if (splitPath[splitPath.length - 1] === '') {
    // Last resort, check if there is something in the same folder called index
    const indexModule = modulesInFoundDirectory.find(m =>
      compareTitle(m.title, 'index', ignoredExtensions)
    );
    if (indexModule) return indexModule;
  }

  return throwError(path);
};

function findById(entities: Array<Module | Directory>, id: string) {
  return entities.find(e => e.id === id);
}

function findByShortid(
  entities: Array<Module | Directory>,
  shortid: string | undefined
) {
  return entities.find(e => e.shortid === shortid);
}

export const getModulePath = memoize(
  (modules: Array<Module>, directories: Array<Directory>, id: string) => {
    const module = findById(modules, id);

    if (!module) return '';

    let directory = findByShortid(directories, module.directoryShortid);
    let path = '/';

    if (directory == null && module.directoryShortid) {
      // Parent got deleted, return '';

      return '';
    }

    while (directory != null) {
      path = `/${directory.title}${path}`;
      const lastDirectoryShortid = directory.directoryShortid;
      directory = findByShortid(directories, directory.directoryShortid);

      // In this case it couldn't find the parent directory of this dir, so probably
      // deleted. we just return '' in that case
      if (!directory && lastDirectoryShortid) {
        return '';
      }
    }
    return `${path}${module.title}`;
  },
  (modules, directories, id) =>
    id +
    modules.map(m => m.id + m.title + m.directoryShortid).join(',') +
    directories.map(d => d.id + d.title + d.directoryShortid).join(',')
);

export const isMainModule = (
  module: Module,
  modules: Module[],
  directories: Directory[],
  entry: string = 'index.js'
) => {
  const path = getModulePath(modules, directories, module.id);

  return path.replace('/', '') === entry;
};

export const findMainModule = (
  modules: Module[],
  directories: Directory[],
  entry: string = 'index.js'
) => {
  try {
    const module = resolveModule(entry, modules, directories);

    return module;
  } catch (e) {
    return modules[0];
  }
};

export const findCurrentModule = (
  modules: Module[],
  directories: Directory[],
  modulePath: string = '',
  mainModule: Module
): Module => {
  // cleanPath, encode and replace first /
  const cleanPath = decodeURIComponent(modulePath).replace('/', '');
  let foundModule = null;
  try {
    foundModule = resolveModule(cleanPath, modules, directories);
  } catch (e) {
    /* leave empty */
  }

  return (
    foundModule ||
    modules.find(m => m.id === modulePath) ||
    modules.find(m => m.shortid === modulePath) || // deep-links requires this
    mainModule
  );
};
