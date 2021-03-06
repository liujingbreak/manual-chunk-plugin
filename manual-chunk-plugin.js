var log = require('@log4js-node/log4js-api').getLogger('wfh.ManualChunkPlugin');
var logFd = require('@log4js-node/log4js-api').getLogger('wfh.ManualChunkPlugin-fd');
var logD = require('log4js').getLogger('wfh.ManualChunkPlugin-d');

var divideLog = require('@log4js-node/log4js-api').getLogger('wfh.ManualChunkPlugin-m');
var _ = require('lodash');
var Path = require('path');
var Tapable = require('tapable');
var chalk = require('chalk');
var nextIdent = 0;

var showFileDep = true;

/**
 * ManualChunkPlugin
 * @param {string} opts.manifest name runtime chunk
 *
 * @param {string} opts.defaultChunkName when encountering a module has not chunk name setting,
 * move it to a default chunk with name of this value
 *
 * @param {function(file: string)} opts.getChunkName(file: string, originalChunk: Chunk)
 * a function returns name of a initial chunk which file belongs
 *
 * @param {function} [optinal] opts.getAsyncChunkName(file: string, originalChunk: Chunk) => string
 * default is appending string ".split" to the string returned by `opts.getChunkName()`.
 * By default split-load chunk's name is null, when this plugin kicks in
 *  1) If chunk is a initial chunk, name that chunk with `opts.getChunkName(file)`
 *  2) If chunk is an async(split-load) chunk, name that chunk with `opts.getAsyncChunkName(file)`
 *     or `opts.getChunkName(file) + ".split"`
 */
function ManualChunkPlugin(opts) {
	Tapable.call(this);
	var self = this;
	this.ident = __filename + (nextIdent++);
	this.opts = opts;
	if (!opts.manifest)
		opts.manifest = 'manifest';
	if (!this.opts.getChunkName || !this.opts.defaultChunkName)
		throw new Error('manual-chunk-plugin requires option property: getChunkName, defaultChunkName');
	if (!this.opts.getAsyncChunkName)
		this.opts.getAsyncChunkName = function(file, chunk) {
			var name = self.opts.getChunkName(file, chunk);
			return (name || self.opts.defaultChunkName) + '.split';
		};
}

module.exports = ManualChunkPlugin;
ManualChunkPlugin.prototype = _.create(Tapable.prototype);
ManualChunkPlugin.prototype.apply = function(compiler) {
	var plugin = this;
	var ident = this.ident;

	compiler.plugin('compilation', function(compilation) {
		if (compilation.compiler.parentCompilation)
			return; // Skip child compilation like what extract-text-webpack-plugin creates
		var bundleInitialChunkMap = {}; // a hash object, key: bundle name, value: chunk instance
		var bundleAsyncChunkMap = {}; // a hash object, key: bundle name + debugId, value: chunk instance

		compilation.plugin(['optimize-chunks', 'optimize-extracted-chunks'], function(chunks) {
			// only optimize once
			if (compilation[ident])
				return;
			compilation[ident] = true;
			log.debug('optimize: %s', chunks.map(c => c.name).join(', '));
			//printChunks(compilation, chunks);

			chunks.forEach(chunk => {
				if (chunk.name ) {
					if (chunk.isInitial())
						bundleInitialChunkMap[chunk.name] = chunk;
					else
						bundleAsyncChunkMap[chunk.name + chunk.debugId] = chunk; // In case of `require.ensure([], .., "chunkName")`
				}
			});

			divideChunks.call(plugin, compilation, chunks, bundleInitialChunkMap, bundleAsyncChunkMap);
		});
	});
	compiler.plugin('emit', function(compilation, callback) {
		log.debug(_.pad(' emit ', 40, '-'));
		printChunks(compilation, compilation.chunks);
		callback();
	});

	function divideChunks(compilation, chunks, bundleInitialChunkMap, bundleAsyncChunkMap) {
		divideLog.debug(_.repeat('-', 10) + ' divide chunks ' + _.repeat('-', 10));
		chunks = chunks.slice();
		// create initial manifest chunk
		var self = this;

		var divededChunkMap = {};
		chunks.forEach(chunk => {
			var divededChunkSet = divededChunkMap[chunk.debugId] = {};
			var isInitialChunk = chunk.isInitial();
			// if (!isInitialChunk && chunk.name) {
			// 	divideLog.debug('Skip already named async chunk [%s]', chunk.name);
			// 	return;
			// }
			divideLog.debug('Scan original chunk [%s]', getChunkName(chunk));
			_.each(chunk.getModules ? chunk.getModules() : chunk.modules, (m, idx) => {
				doModule(self, compilation, chunk, m, isInitialChunk, bundleInitialChunkMap, bundleAsyncChunkMap, divededChunkSet);
			});
			divideLog.debug('');
		});

		removeEmptyChunk(compilation);

		var manifestChunk = compilation.addChunk(plugin.opts.manifest);
		_.each(compilation.entrypoints, (entrypoint, name) => {
			entrypoint.insertChunk(manifestChunk, entrypoint.chunks[0]);
			manifestChunk.addChunk(entrypoint.chunks[1]);
			entrypoint.chunks[1].addParent(manifestChunk);
		});
	}

	function doModule(plugin, compilation, chunk, m, isInitialChunk,
		bundleInitialChunkMap, bundleAsyncChunkMap, divededChunkSet) {
		var self = plugin;
		divideLog.debug('├─ Module: %s', simpleModuleId(m));
		var file = m.resource || _.get(m, ['fileDependencies', 0]);
		if (!file) {
			divideLog.debug('│ ├─ Skip due to not a NormalModule'); // probable a ContextModule
			return;
		}
		var bundle = isInitialChunk ? self.opts.getChunkName(file, chunk) : self.opts.getAsyncChunkName.call(self, file, chunk);

		if (bundle == null) {
			divideLog.warn('│ ├─ Use chunk [%s] for %s', self.opts.defaultChunkName,
				chalk.red(Path.relative(compiler.options.context || process.cwd(), file)));
			bundle = self.opts.defaultChunkName;
		}
		if (chunk.name == null) {
			if (isInitialChunk && !_.has(bundleInitialChunkMap, bundle)) {
				chunk.name = bundle;
				bundleInitialChunkMap[bundle] = chunk;
				return;
			} else if (!isInitialChunk && !_.has(bundleAsyncChunkMap, bundle)) {
				chunk.name = bundle;
				bundleAsyncChunkMap[bundle + chunk.debugId] = chunk;
				return;
			}
		}
		if (bundle === chunk.name) {
			if (isInitialChunk)
				bundleInitialChunkMap[bundle] = chunk;
			else
				bundleAsyncChunkMap[bundle + chunk.debugId] = chunk;
			return;
		}
		moveModuleAndCreateChunk.call(compilation, bundleInitialChunkMap, bundleAsyncChunkMap,
			m, file, bundle, divededChunkSet, chunk, isInitialChunk);
	}

	function moveModuleAndCreateChunk(bundleInitialChunkMap, bundleAsyncChunkMap, m, file, bundle,
		divededChunkSet, chunk, isInitialChunk) {
		var newChunk;
		if (isInitialChunk && _.has(bundleInitialChunkMap, bundle)) {
			newChunk = bundleInitialChunkMap[bundle];
			divideLog.debug('│ ├─ existing chunk [%s]', getChunkName(newChunk));
		} else if (!isInitialChunk && _.has(bundleAsyncChunkMap, bundle + chunk.debugId)) {
			newChunk = bundleAsyncChunkMap[bundle];
			divideLog.debug('│ ├─ existing async chunk [%s]', getChunkName(newChunk));
		} else {
			newChunk = this.addChunk(bundle);
			divideLog.debug('│ ├─ Create %s chunk %s', isInitialChunk ? 'initial' : 'async', getChunkName(newChunk));
			if (isInitialChunk)
				bundleInitialChunkMap[bundle] = newChunk;
			else
				bundleAsyncChunkMap[bundle + newChunk.debugId] = newChunk;
		}
		// move module
		chunk.moveModule(m, newChunk);
		divideLog.debug('│ ├─ move module from chunk [%s] to [%s]', getChunkName(chunk), getChunkName(newChunk));
		// m.removeChunk(chunk);
		// var added = newChunk.addModule(m);
		// if (added) {
		// 	m.addChunk(newChunk);
		// 	divideLog.debug('\t\tmove module "%s" from chunk [%s] to [%s]', simpleModuleId(m), getChunkName(chunk), getChunkName(newChunk));
		// } else {
		// 	divideLog.debug('\t\tremove module "%s" from chunk [%s]', simpleModuleId(m), getChunkName(chunk));
		// }
		if (_.has(divededChunkSet, newChunk.debugId))
			return;
		divideLog.debug('│ ├─ chunk [%s] is splitted', getChunkName(chunk));
		divededChunkSet[newChunk.debugId] = 1;

		if (isInitialChunk) {
			newChunk.addChunk(chunk);
			if (chunk.parents && chunk.parents.length > 0)
				chunk.parents.forEach(p => {
					p.removeChunk(chunk);
					p.addChunk(newChunk);
					newChunk.addParent(p);
				});
			chunk.parents = [newChunk];
			_.each(chunk.entrypoints, (entrypoint) => {
				var existing = entrypoint.chunks.indexOf(newChunk);
				if (existing >= 0)
					entrypoint.chunks.splice(existing, 1);
				entrypoint.insertChunk(newChunk, chunk);
			});
		} else {
			// require.ensure() loaded chunk
			//_.each(chunk.blocks, block => );
			chunk.parents.forEach(p => {
				newChunk.addParent(p);
				p.addChunk(newChunk);
			});
			_.each(chunk.blocks, block => {
				newChunk.addBlock(block);
				if (block.chunks.indexOf(newChunk) < 0)
					block.chunks.push(newChunk);
			});
		}
	}

	function removeEmptyChunk(compilation) {
		_.remove(compilation.chunks, chunk => {
			if (chunk.isEmpty() && !chunk.hasRuntime()) {
				log.info('Empty chunk %s', getChunkName(chunk));
				chunk.remove('empty');
				//compilation.chunks.splice(compilation.chunks.indexOf(chunk), 1);
				if (chunk.name)
					delete compilation.namedChunks[chunk.name];
				return true;
			}
			return false;
		});
	}

	function simpleModuleId(m) {
		// var loaders = m.request.split('!');
		// loaders.pop();
		return (m.resource ? Path.relative(compiler.options.context, m.resource) : m.identifier());
	}

	function printChunks(compilation, chunks) {
		chunks.forEach(function(chunk) {
			log.debug('chunk: %s, parents:(%s), %s, ids: %s',
				getChunkName(chunk),
				chunk.parents.map(p => getChunkName(p)).join(', '), chunk.isInitial() ? 'isInitial' : '', chunk.ids);
			log.debug('\tchildren: (%s)', chunk.chunks.map(ck => getChunkName(ck)).join(', '));
			log.debug('\t%s %s', chunk.hasRuntime() ? '(has runtime)' : '', chunk.hasEntryModule() ? `(has entryModule: ${simpleModuleId(chunk.entryModule)})` : '');

			log.debug('  ├─ modules');
			(chunk.getModules ? chunk.getModules() : chunk.modules).forEach(function(module) {
				// Explore each source file path that was included into the module:
				log.debug('  │  ├─ %s', simpleModuleId(module));
				if (showFileDep)
					_.each(module.fileDependencies, filepath => {
						logFd.isDebugEnabled() && log.debug('  │  │  ├─ %s', chalk.blue('(fileDependency): ' + Path.relative(compiler.options.context, filepath)));
					});
				_.each(module.blocks, block => {
					log.debug('  │  │  ├─ (block %s): %s', block.constructor.name,
						_.map(block.chunks, ck => {
							return getChunkName(ck);
						}).join(', '));
					if (logD.isDebugEnabled()) {
						_.each(block.dependencies, bDep => {
							log.debug(`  │  │  │  ├─ ${bDep.constructor.name}`);
							if (bDep.module)
								log.debug(`  │  │  │  │  ├─ .module ${simpleModuleId(bDep.module)}`);
						});
					}
				});
				if (logD.isDebugEnabled()) {
					_.each(module.dependencies, dep => {
						var source = module._source ? module._source.source() : null;
						log.debug('  │  │  ├─ %s: %s', chalk.blue(`(dependency ${dep.constructor.name})`),
							(dep.range && source) ? source.substring(dep.range[0], dep.range[1]) : '');
						if (dep.module)
							log.debug(`  │  │  │  ├─ .module ${chalk.blue(simpleModuleId(dep.module))}`);
					});
				}
			});
			log.debug('  │  ');

			// Explore each asset filename generated by the chunk:
			chunk.files.forEach(function(filename) {
				log.debug('  ├── file: %s', filename);
				// Get the asset source for each file generated by the chunk:
				//var source = compilation.assets[filename].source();
			});
		});
		printChunksByEntry(compilation);
	}

	function getChunkName(chunk) {
		var id = chunk.debugId;
		if (chunk.id)
			id = chunk.id + '-' + chunk.debugId;
		return '#' + id + ' ' + chalk.green(chunk.name || '');
	}

	function printChunksByEntry(compilation) {
		_.each(compilation.entrypoints, (entrypoint, name) => {
			log.info('entrypoint %s', chalk.green(name));
			_.each(entrypoint.chunks, chunk => log.info('\t%s', chunk.files[0]));
		});
	}
};

