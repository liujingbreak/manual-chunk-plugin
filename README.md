# Manual chunk plugin

This is a Webpack 2 plugin for splitting chunk file via manual assignment. (Which I believe is more flexible for multi-entry application)

Unlike Webpack's CommonChunkPlugin
- It is not limited for only creating **app**, **common**, **manifest** chunks
it can create unlimited number of chunks.
- For multi-entry project or 'vendor' + 'app' like project, you don't need to put mutiple "CommonChunkPlugin" in config file.

Each **module** can only be assigned to 1 chunk file during that compilation, you get to wisely decide what chunk name that module should be assigned to. Plugin will maintain correct relationship (parent, child, async) between these chunks of entire compilation. Totally support splitloading chunk as what `require.ensure()` creates.

Assume you have a project with 3 entries *app1*, *app2*, *app3*, while *app1*, *app2* depends on `lib` and `node_modules/module1`, *app3* only depends on `node_modules/module1`
```
process.cwd()
├─── app1/
│    ├─── index.js
│    └─── stylesheets
│          └─── style1.css
├─── app2/
│    ├─── index.js
│    └─── stylesheets
│          └─── style2.css
├─── app3/
│    ├─── index.js
│    └─── stylesheets
│          └─── style3.css
├─── lib/
│    └─── index.js
│
└─── node_modules/
      └─── module1/index.js, package.json, ...
```
e.g.
In webpack.config.js, assume I use top level directory name as chunk name for those modules.
```js
plugins: [
	new ManualChunkPlugin({
		// The chunk name for manifest
		manifest: 'runtime',
		// The default chunk name if getChunkName(file) returns null for that module
		defaultChunkName: 'vendor-lib'), 
		// Callback to return chunk name of each "module",
		// Returning same chunk name for different "module" leads to put then into same chunk file
		getChunkName: (file) => {
			var relativePath = path.relative(process.cwd(), file);
			var dirName = relativePath.split(path.sep)[0];
			return dirName === 'node_modules' ? 'vendor-lib' : dirName;
		}
	}),
	...
]
```
Eventually, compilation comes up with 5 chunk assets
- app1.js
- app2.js
- app3.js
- lib.js
- vendor-lib.js
- runtime.js

Their relationship is like (you can hack `chunks` property from Webpack compilation object to oversee parent-child relationship):
- app1.js ───> lib.js ───> vendor-lib.js ───> runtime.js
- app2.js ───> lib.js ───> vendor-lib.js ───> runtime.js
- app3.js ───> vendor-lib.js ───> runtime.js

Chunk `runtime` is the small Webpack `manifest` chunk which changes every time, you'd better use some plugin to inline it into all your entry HTML files.

So I create 2 common chunks for 3 entries so that if a client will access all 3 tree of these entries, all chunks can be cached in browser, but on duplicate modules will be downloaded.

Or I can also combine `lib` and `vendor-lib` into a single chunk, every combination is under my explicit controll.

The good thing of this plugin in contrast with CommonChunkPlugin is, it is very streightforward to understand how chunks are actually splitted, but CommonChunkPlugin will decide splitting depends on *how often* a module is referred by other chunk, and you may need to manuly put "vendor" chunk in config file it you want to split more than 1 common chunk, which is not the part I want it to be `manual`.

It plugin doesn't come up with unit test file, because it is just seperated from my company's common architecture project as a part and covered by its integration test.
