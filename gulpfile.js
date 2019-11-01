var _ = require('lodash');
var async = require('async');
var clean = require('gulp-clean');
var exec = require('child_process').exec;
var firstline = require('firstline');
var format = require('string-format');
var fs = require('fs');
var gulp = require('gulp');
var gzip = require('gulp-gzip');
var reader = require('line-reader');
var rename = require('gulp-rename');
var semver = require('semver');
var tar = require('gulp-tar');
var shell = require('gulp-shell');

var version;
var title;

format.extend(String.prototype);

function get_changelog(cb) {
    var file = 'docs/CHANGES.txt';
    var counter = 0;
    var lines = [];

    reader.eachLine(file, function(line) {
        counter++;

        var trimmed = line.trim();

        if (counter === 1) {
            return;
        }

        if (line === '') {
            return;
        }

        if (trimmed.startsWith('--')) {
            return false; // stop reading
        } else {
            lines.push(trimmed);
        }
    }, function(err) {
        if (err) {
            cb(err);
        }

        var fixed = [];

        _.each(lines, function(line) {
            if (line.startsWith('*')) {
                fixed.push(line);
            } else {
                fixed[fixed.length - 1] = fixed[fixed.length - 1] + ' ' + line;
            }
        });

        cb(null, fixed);
    });
}

function get_version() {
    var changes = 'docs/CHANGES.txt';

    return firstline(changes);
}

gulp.task('version', function(callback) {
    get_version().then(function(version_string) {
        version = version_string;
        title = 'osdf-{}'.format(version);
        callback();
    });
});

var sources = [
    'README.md',
    '*.js',
    '!gulpfile.js',
    'bin/**',
    'conf/**',
    'debian/**',
    'docs/**',
    'lib/**',
    'logs/**',
    'node_modules/**',
    'test/**',
    'util/**',
    'working/**'
];

// remove the build and dist directories
gulp.task('clean', function() {
    return gulp.src(['build', 'dist'])
        .pipe(clean());
});

// Compile the jison based parser.
gulp.task('oql_parser', function() {
    return gulp.src('./util/oql.jison')
        .pipe(shell(['./node_modules/.bin/jison <%= file.path %> -o oql_jison_parser.js']));
});

gulp.task('deps', gulp.series(['oql_parser'], function() {
    return gulp.src('.')
        .pipe(shell(['npm install']));
}));

gulp.task('build', gulp.series(['version', 'deps'], function() {
    return gulp.src(sources, {'base': '.'})
        .pipe(gulp.dest('build/' + title));
}));

gulp.task('tar', gulp.series(['build'], function() {
    return gulp.src('build/' + title + '/**', {'base': 'build'})
        .pipe(tar(title + '.tar'))
        .pipe(gulp.dest('build'));
}));

gulp.task('gzip', gulp.series(['tar'], function() {
    var tarfile = 'build/{}.tar'.format(title);

    return gulp.src(tarfile, {'base': 'build'})
        .pipe(gzip())
        .pipe(gulp.dest('build'));
}));

gulp.task('bump_package_files', gulp.series(['version'], function(cb) {
    var filename = './package.json';

    fs.readFile(filename, 'utf-8', function(err, data) {
        var parsed = JSON.parse(data);
        parsed.version = version;

        if (! semver.valid(parsed.version)) {
            cb('Invalid version ' + version);
            return;
        }

        fs.writeFile(filename, JSON.stringify(parsed, null, 4), function(err) {
            if (err) {
                cb(err);
            } else {
                cb();
            }
        });
    });
}));

gulp.task('latest_changes', function(cb) {
    get_changelog(function(err, lines) {
        console.log(lines.join('\n'));
        cb();
    });
});

gulp.task('deb_orig_tarball', gulp.series(['gzip'], function() {
    return gulp.src('build/{}.tar.gz'.format(title))
        .pipe(rename('osdf_{}.orig.tar.gz'.format(version)))
        .pipe(gulp.dest('build'));
}));

// Create the deb package file.
gulp.task('deb', gulp.series(['deb_orig_tarball'], function(callback) {
    var debuild = 'debuild -us -uc --lintian-opts ' +
                  '--suppress-tags bad-distribution-in-changes-file';

    var opts = {
        cwd: './build/' + title
    };

    exec(debuild, opts, function(err, stdout, stderr) {
        if (stderr) {
            console.log(stderr);
        }
        callback(err);
    });
}));

// Run the unit tests in the test directory.
gulp.task('test', function() {
    var test_scripts = [
        './test/aux-*.js',
        './test/linkage-*.js',
        './test/namespace-*.js',
        './test/node-*.js',
        './test/oql*.js',
        './test/osdf-info.js',
        './test/permissions.js',
        './test/schema-*.js'
    ];
    gulp.src(test_scripts)
        .pipe(shell(['mocha <%= file.path %>'],
            {env: {NODE_PATH: '.:./lib'}}
        ));
});

gulp.task('dist', gulp.series(['deb'], function() {
    var base = 'build/osdf_' + version;
    var tarball = 'build/osdf-{}.tar.gz'.format(version);
    var files = [
        base + '*.buildinfo',
        base + '*.changes',
        base + '*.debian.tar.xz',
        base + '*.deb',
        base + '*.dsc',
        tarball
    ];

    return gulp.src(files)
        .pipe(gulp.dest('dist'));
}));

gulp.task('default', gulp.series(['dist'], function(cb) {
    cb(null);
}));
