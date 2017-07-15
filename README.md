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
		// A required callback function that returns chunk name of each "module",
		// Returning same chunk name for different "module" leads to put then into same chunk file
		getChunkName: (file, originalChunk) => {
			var relativePath = path.relative(process.cwd(), file);
			var dirName = relativePath.split(path.sep)[0];
			return dirName === 'node_modules' ? 'vendor-lib' : dirName;
		},
		// An optional callback function that returns chunk name of split-load "module":
		// function(file: string, originalChunk: Chunk) => string
		// default behaviour is appending ".split" to the string returned by `opts.getChunkName()`.
		// By default split-load chunk's name is null, when this plugin kicks in
		//  1) If chunk is a initial chunk, will name that chunk with `opts.getChunkName(file)`
		//  2) If chunk is an async(split-load) chunk, will name that chunk with `opts.getAsyncChunkName(file)`
		//     or `opts.getChunkName(file) + ".split"`
		getAsyncChunkName: (file, originalChunk) => this.opts.getChunkName(file, originalChunk) + '.split'
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

The good part of this plugin in contrast with CommonChunkPlugin is that, it is very streightforward to understand how chunks are actually splitted, but as for CommonChunkPlugin you may need to manually put "vendor" chunk in config file it you want to split more than 1 common chunk, which is not the part I want it to be `manual`.

It plugin doesn't come up with unit test file, because it is just seperated from my company's common architecture project [https://github.com/dr-web-house](https://github.com/dr-web-house) ([Document](http://dr-web-house.github.io)) as a part and covered by its integration test. 
