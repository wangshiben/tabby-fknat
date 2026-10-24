const path = require('path')
const webpack = require('webpack')
const { version } = require('./package.json')

module.exports = {
    target: 'electron-renderer',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'commonjs2',
    },
    devtool: 'source-map',
    plugins: [new webpack.DefinePlugin({ __FKNAT_PLUGIN_VERSION__: JSON.stringify(version) })],
    resolve: { extensions: ['.ts', '.js'] },
    module: {
        rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    externals: [
        ({ request }, callback) => {
            if (request && (
                request.startsWith('node:') ||
                request.startsWith('@angular/') ||
                request.startsWith('@ng-bootstrap/') ||
                request === 'rxjs' || request.startsWith('rxjs/') ||
                request.startsWith('tabby-')
            )) {
                return callback(null, `commonjs ${request}`)
            }
            callback()
        },
    ],
}
