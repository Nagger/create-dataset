#!/usr/bin/env node

const showdown = require("showdown");
const showdownHighlight = require("showdown-highlight");
var Q = require("q");
const fs = require("fs");
const sqlite3 = require("sqlite3");
const path = require("path");
const mkdirp = require("mkdirp");
const plist = require("plist");

const nameDocset = "redux-form";
const virtualCatalog = "api";
const virtualCatalogPath = virtualCatalog ? `/${virtualCatalog}` : "";
const input = `./source_doc/${nameDocset}${virtualCatalogPath}`;
const output = `./docset/${nameDocset}`;

const dbFile = path.resolve(
	__dirname,
	"./" + output + "/Contents/Resources/docSet.dsidx"
);
fs.unlink(dbFile, function(error) {
	if (!error) {
		console.log("Previous database deleted!");
	}
});

var db = null;
const contentsPath = path.resolve(__dirname, "./" + output + "/Contents/");
const documentsPath = `${contentsPath}/Resources/Documents${virtualCatalogPath}/`;

showdown.setFlavor("github");

const extReg = /([.]md)|([.]markdown)/;
console.log(input);

let directories = fs.readdirSync(input);

const createDir = () => {
	return Q.Promise(function(resolve, reject) {
		mkdirp(documentsPath, function(err) {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};

const createDb = () => {
	db = new sqlite3.Database(dbFile);
	db.serialize(function() {
		db.run(
			"CREATE TABLE searchIndex(id INTEGER PRIMARY KEY, name TEXT, type TEXT, path TEXT);"
		);
		db.run("CREATE UNIQUE INDEX anchor ON searchIndex (name, type, path);");
	});
};

const readFile = (markdownPath, markdown, directory) => {
	return Q.Promise(function(resolve, reject) {
		fs.readFile(markdownPath, "utf8", (err, data) => {
			if (err) {
				reject(err);
			} else {
				resolve({ data, markdownPath, markdown, directory });
			}
		});
	});
};

const generateHtml = ({ data, markdownPath, markdown, directory }) => {
	// convert to HTML
	const converter = new showdown.Converter({
		extensions: [showdownHighlight]
	});
	return Q.Promise(function(resolve, reject) {
		data = converter.makeHtml(data);
		resolve({ data, markdownPath, markdown, directory });
	});
};

const replaceLink = ({ data, markdownPath, markdown, directory }) => {
	return Q.Promise(function(resolve, reject) {
		//<a href="https://redux-form.com/6.2.0/docs/api/Field.md/"></a>
		//<a href="Props.md">
		let regex = /<a href="(.*).md">/gm;
		let subst = `<a href="$1.html">`;
		data = data.replace(regex, subst);
		regex = /(https:\/\/redux-form\.com\/).*docs\/api(\/)(.*)\.html/gm;
		subst = `$3.html`;
		data = data.replace(regex, subst);
		resolve({ data, markdownPath, markdown, directory });
	});
};

const indexAnchor = ({ data, markdownPath, markdown, directory }) => {
	return Q.Promise(function(resolve) {
		var matches;
		const name = markdown.replace(extReg, "");
		var stmt = db.prepare(
			"INSERT OR IGNORE INTO searchIndex(name, type, path) VALUES (?, ?, ?)"
		);
		const virtualCatalogTmp = virtualCatalog ? virtualCatalog + "/" : "";
		stmt.run(name, directory, virtualCatalogTmp + name + ".html");

		const guidesRegex = /<h4 id="(.*)".*<code>([^:(]*)[:(]*.*<\/code>/gm;
		while ((matches = guidesRegex.exec(data))) {
			stmt.run(
				matches[2],
				"Property",
				virtualCatalogTmp + name + ".html#" + matches[1]
			);
		}

		stmt.finalize();
		console.log("Search index created!");
		resolve({ data, markdownPath, markdown });
	});
};

const saveHtml = ({ data, markdownPath, markdown }) => {
	return Q.Promise(function(resolve, reject) {
		var header = fs.readFileSync("./static/header.txt");
		var footer = fs.readFileSync("./static/footer.txt");

		let htmlPath = path.join(
			documentsPath,
			markdown.replace(extReg, "") + ".html"
		);

		data = header + data + footer;

		fs.writeFile(htmlPath, data, err => {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});

		console.log("Body wrapped with header and footer!");
	});
};

generatePlist = () => {
	return Q.Promise((resolve, reject) => {
		console.log("Generating plist...");

		const plistData = {
			CFBundleIdentifier: "cheatsheet",
			CFBundleName: nameDocset || "No Title",
			DocSetPlatformFamily: "cheatsheet",
			DashDocSetFamily: "dashtoc", //'cheatsheet',
			isDashDocset: true,
			dashIndexFilePath: "api/README.html"
		};
		const builtPlist = plist.build(plistData);
		let infoPath = path.join(contentsPath, "Info.plist");
		console.log(infoPath);
		fs.writeFile(infoPath, builtPlist, err => {
			if (err) {
				reject(err);
			} else {
				resolve(true);
			}
		});
	});
};

const processDir = () => {
	return Q.Promise((resolve, reject) => {
		for (let j = 0, l = directories.length; j < l; j++) {
			let directory = directories[j];
			let markdowns = fs.readdirSync(path.join(input, directory));
			for (let i = 0, len = markdowns.length; i < len; i++) {
				let markdown = markdowns[i];

				let ext = path.extname(markdown);

				if (ext !== ".md" && ext !== ".markdown") {
					continue;
				}

				let markdownPath = path.join(input, directory, markdown);

				// read markdown file
				readFile(markdownPath, markdown, directory)
					.then(generateHtml)
					.then(replaceLink)
					.then(indexAnchor)
					.then(saveHtml)
					.catch(err => console.log(err));
			}
		}
		resolve();
	});
};

createDir()
	.then(createDb)
	.then(processDir)
	.then(generatePlist);
