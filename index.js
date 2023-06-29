const fs = require("fs");
const path = require("path");
const url = require("url");
const axios = require("axios");
const CancelToken = axios.CancelToken;

let cancel;
let source = "";
let commandArgs = {};
let cache = {};

// Template Stuff
const template = {
    header:
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n" +
        "<!-- This is an automatically generated file.\n" +
        "     It will be read and overwritten.\n" +
        "     DO NOT EDIT! -->\n" +
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
        "<TITLE>Bookmarks</TITLE>\n" +
        "<H1>Bookmarks</H1>\n" +
        "<DL><p>\n",
    start: '     <DT><H3 ADD_DATE="{date}" LAST_MODIFIED="{modified}" PERSONAL_TOOLBAR_FOLDER="false">{name}</H3>\n     <DL><p>\n',
    end: "     </DL><p>\n",
    item: '          <DT><A HREF="{url}" ADD_DATE="{date}" ICON="{icon}" LAST_MODIFIED="{modified}">{title}</A>\n',
};

// Check if an object has a key
Object.prototype.has = function (key) {
    return Object.keys(this).includes(key);
};

// Process the command line arguments
const commandlineArgs = (args) => {
    let command = {};
    let regex = new RegExp(/(\w+)\s?(.*)?/);

    let argsArr = args
        .slice(2)
        .join(" ")
        .split(/-|--/g)
        .map((t) => {
            return t.trim();
        })
        .filter(Boolean);

    for (let cmd of argsArr) {
        let words = cmd.match(regex);
        command[words[1]] = words[2];
    }

    return command;
};

// Does directory exist
const dirExists = (dir) => {
    try {
        fs.opendirSync(dir, (err, isDir) => {
            if (err) return false;
            isDir.close();
        });
    } catch (err) {
        return false;
    }
    return true;
};

// Extract the thumbnail if it exists.
const extractThumbnail = (_url, data) => {
    let base64Header = new RegExp(/(^data\:image\/(\w+);base64,)/);

    if (base64Header.test(data)) {
        let matches = data.match(base64Header);
        let parser = url.parse(_url, true);
        let host = (parser.host + parser.pathname).replace(/\.|\//g, "-");
        let file = path.join(commandArgs.x, host + "." + matches[2]);

        data = data.replace(matches[1], "");
        fs.writeFileSync(file, data, { encoding: "base64" });
        console.log("✅ Thumbnail extracted: " + file);
    }
};

// Get the favicon if it exists
const getFavicon = (_url) => {
    return new Promise((resolve, reject) => {
        let hostname = url.parse(bookmark.url, true).host;

        axios({
            method: "GET",
            url: `http://${hostname}/favicon.ico`,
            responseType: "arraybuffer",
            cancelToken: new CancelToken(function executor(c) {
                cancel = c;
            }),
            timeout: 5000,
        })
            .then((response) => {
                console.log("🙋 Got an icon for " + hostname);
                const base64 = Buffer.from(response.data, "binary").toString("base64");
                cache[hostname] = "data:image/ico;base64," + base64;
                resolve("data:image/ico;base64," + base64);
            })
            .catch((error) => {
                cancel();
                resolve("");
            });
    });
};

// Get groups from FVD file
const getGroups = () => {
    let groups = [];

    source["db"]["groups"].forEach((group) => {
        groups.push({ id: group.id, name: group.name });
    });
    return groups;
};

// Get dials from a group
const getDials = async (id) => {
    let temp = [];

    bookmarks = source["db"]["dials"].filter((d) => d.group_id == id);
    for (bookmark of bookmarks) {
        let builder = {};

        builder["title"] = bookmark.title;
        builder["url"] = bookmark.url;
        builder["icon"] = "";

        // get a new favicon
        if (commandArgs.has("f")) {
            let hostname = url.parse(bookmark.url, true).host;

            if (cache.has(hostname)) builder["icon"] = cache[hostname];
            else builder["icon"] = await getFavicon(bookmark.url);
        }

        // extract the thumbnail
        if (commandArgs.has("x")) extractThumbnail(bookmark.url, bookmark.thumb);

        temp.push(builder);
    }
    return temp;
};

// Creates the html
const doHTML = (fvdData) => {
    let html = template.header;

    for (data in fvdData) {
        let key = data;
        let value = fvdData[data];

        // Because I prototyped the object it tries to dump that function out
        // Just have to skip that
        if (typeof value !== "function") {
            html += template.start
                .replace("{name}", key)
                .replace("{date}", new Date().getTime())
                .replace("{modified}", new Date().getTime());

            value.forEach((bookmark) => {
                html += template.item
                    .replace("{title}", bookmark.title)
                    .replace("{url}", bookmark.url)
                    .replace("{date}", new Date().getTime())
                    .replace("{modified}", new Date().getTime())
                    .replace("{icon}", bookmark.icon);
            });
            html += template.end;
        }
    }
    return html;
};

// Start
const convertFile = async () => {
    let tempJSON = [];

    source = JSON.parse(fs.readFileSync(commandArgs.i, "utf-8"));

    for (group of getGroups()) {
        console.log(`📂 Starting ${group.name}`);
        tempJSON[group.name] = await getDials(group.id);
        console.log(`😎 Finished ${group.name} with ${tempJSON[group.name].length} bookmarks`);
        console.log();
    }

    fs.writeFileSync(commandArgs.o, doHTML(tempJSON), "utf-8");
    console.log(`✅ HTML bookmarks file created!`);
};

// ***********************************************************************

// Process the command line
commandArgs = commandlineArgs(process.argv);

if (commandArgs.has("i") && commandArgs.has("o")) {
    if (!fs.existsSync(commandArgs.i)) {
        console.log("❌ Input file does not exist");
        process.exit(100);
    }

    if (commandArgs.has("x") == true) {
        if (!dirExists(commandArgs.x)) {
            console.log("❌ Extract directory does not exist");
            process.exit(200);
        }
    }

    convertFile();
} else if (commandArgs.has("help") || commandArgs.has("h") || commandArgs.has("?")) {
    console.log("Usage:");
    console.log("node index.js -i source.json -o import.html");
    console.log("node index.js -i source.json -o import.html -x ./thumbnails -f");
    console.log();
    console.log("-i [input file], -o [output file]");
    console.log("-x [extract thumbnails to directory, -f Update the favicon");
    console.log();
    console.log("* [f]: Will attempt to download the favicon from the website");
    console.log("  and add it to the bookmark import file.");
    console.log();
    console.log("* [x]: The eXtract option only extracts thumbnails of dials with");
    console.log("  thumbnails that were manually assigned.  (Not automatic thumbnails)");
    console.log("  the automatic thumbnails are not stored in this file!");
} else {
    console.log("Usage:");
    console.log("node index.js -i source.json -o import.html");
    console.log("node index.js --help (for more command options)");
}
