//TODO: Import Author info
//TODO: Only published posts
//TODO: Categories and Tags
//TODO: Handle missing images
//TODO: Remove HTML Comments
//TODO: Fix links to images that we've downloaded
//TODO: Ensure code highlighting works


const { format } = require("date-fns");
const fetch = require("node-fetch");
const path = require("path");
const prettier = require("prettier");

const xml2js = require("xml2js");
const fs = require("fs");
const slugify = require("slugify");
const htmlentities = require("he");
const {
    cleanupShortcodes,
    fixCodeBlocks,
    codeBlockDebugger,
    fixBadHTML,
    fixEmbeds,
} = require("./articleCleanup");

const unified = require("unified");
const parseHTML = require("rehype-parse");
const rehype2remark = require("rehype-remark");
const stringify = require("remark-stringify");
const imageType = require("image-type");

// includes all sorts of edge cases and weird stuff
processExport("../MsftBlog/export.xml");
const date_notBefore = new Date(2019,01,01);
// full dump
// processExport("ageekwithahat.wordpress.2020-08-22 (1).xml");

function processExport(file) {
    const parser = new xml2js.Parser();

    fs.readFile(file, function (err, data) {
        if (err) {
            return console.log("Error: " + err);
        }

        parser.parseString(data, function (err, result) {
            if (err) {
                return console.log("Error parsing xml: " + err);
            }
            console.log("Parsed XML");

            const posts = result.rss.channel[0].item;
//<wp:status><![CDATA[publish]]></wp:status>
            fs.mkdir("out", function () {
                posts
                    .filter((p) =>  p["wp:post_type"][0] === "post" && p["wp:status"][0] === "publish"  )
                    .forEach(processPost);
            });
        });
    });
}

function constructImageName({ urlParts, buffer }) {
    const pathParts = path.parse(
        urlParts.pathname
            .replace(/^\//, "")
            .replace(/\//g, "-")
            .replace(/\*/g, "")
    );
    const { ext } = imageType(new Buffer(buffer));

    return `${pathParts.name}.${ext}`;
}

async function processImage({ url, postData, images, directory }) {
    let cleanUrl = htmlentities.decode(url);
    if (cleanUrl.startsWith("/")) {
        console.log("Adding domain to image: " + cleanUrl);
        cleanUrl = "https://msrc-blog.microsoft.com" + cleanUrl;
        console.log(cleanUrl);
    }
    if (cleanUrl.startsWith("./img")) {
        console.log(`Already processed ${cleanUrl} in ${directory}`);

        return [postData, images];
    }

    const urlParts = new URL(cleanUrl);

    const filePath = `out/${directory}/img`;
    console.log("writing image  to " + filePath);
    try {
        const response = await downloadFile(cleanUrl);
        const type = response.headers.get("Content-Type");

        if (type.includes("image") || type.includes("octet-stream")) {
            const buffer = await response.arrayBuffer();
            const imageName = constructImageName({
                urlParts,
                buffer,
            });

            //Make the image name local relative in the markdown
            postData = postData.replaceAll(url, `./img/${imageName}`);
            images = [...images, `./img/${imageName}`];
            console.log(`${filePath}/${imageName}`);

            fs.writeFileSync(`${filePath}/${imageName}`, new Buffer(buffer));
        }
    } catch (e) {
        console.log(`Keeping ref to ${url}`);
    }

    return [postData, images];
}

async function processImages({ postData, directory }) {
    const patt = new RegExp('(?:src="(.*?)")', "gi");
    let images = [];

    var m;
    let matches = [];

    while ((m = patt.exec(postData)) !== null) {
        if (!m[1].endsWith(".js")) {
            matches.push(m[1]);
        }
    }

    if (matches != null && matches.length > 0) {
        for (let match of matches) {
            try {
                [postData, images] = await processImage({
                    url: match,
                    postData,
                    images,
                    directory,
                });
            } catch (err) {
                console.log("ERROR PROCESSING IMAGE", match);
            }
        }
    }

    return [postData, images];
}

async function processPost(post) {
    console.log("Processing Post");

    const postLink = post.link;
    const postTitle =
        typeof post.title === "string" ? post.title : post.title[0];
    console.log("Post title: " + postTitle);
    const postDate = isFinite(new Date(post.pubDate))
        ? new Date(post.pubDate)
        : new Date(post["wp:post_date"]);

    if (postDate < date_notBefore) {
        return;
    }

    console.log("Post Date: " + postDate);

    let author = post["dc:creator"][0];
    let postData = post["content:encoded"][0];
    console.log("Post length: " + postData.length + " bytes");
    const slug = slugify(postTitle, {
        remove: /[^\w\s]/g,
    })
        .toLowerCase()
        .replace(/\*/g, "");
    console.log("Post slug: " + slug);

    // takes the longest description candidate
    const description = "";
/*    const description = [
        post.description,
        ...post["wp:postmeta"].filter(
            (meta) =>
                meta["wp:meta_key"][0].includes("metadesc") ||
                meta["wp:meta_key"][0].includes("description")
        ),
    ].sort((a, b) => b.length - a.length)[0]; */

    const heroURLs = [];
    /* post["wp:postmeta"]
        .filter(
            (meta) =>
                meta["wp:meta_key"][0].includes("opengraph-image") ||
                meta["wp:meta_key"][0].includes("twitter-image")
        )
        .map((meta) => meta["wp:meta_value"][0])
        .filter((url) => url.startsWith("http"));
*/
    let heroImage = "";
    var dd = String(postDate.getDate()).padStart(2, '0');
    var mm = String(postDate.getMonth() + 1).padStart(2, '0'); //January is 0!
    var yyyy = postDate.getFullYear();


    //yyyy + "/" + mm + "/" + dd + "/" + slug;
    //actually why not make it from the post link property?
    var directory = String(postLink);
    directory = directory.replace("https://msrc-blog.microsoft.com/", "");
    directory = directory.substring(0, directory.length-1);
    console.log("Directory to be created: " + directory);

    let fname = `index.md`;

    try {
        fs.mkdirSync(`out/${directory}`, {recursive: true});
        fs.mkdirSync(`out/${directory}/img`, {recursive: true});
    } catch (e) {
/*        directory = directory + "-2";
        fs.mkdirSync(`out/${directory}`);
        fs.mkdirSync(`out/${directory}/img`); */
    }

    //Merge categories and tags into tags
    /*
    <category domain="category" nicename="msrc"><![CDATA[MSRC]]></category>
    <category domain="post_tag" nicename="report-vulnerability"><![CDATA[Report Vulnerability]]></category>
    <category domain="post_tag" nicename="researcher-portal"><![CDATA[Researcher Portal]]></category>
    		<wp:cat_name><![CDATA[Security Research &amp; Defense]]></wp:cat_name>

    */
    const catList = post.category.filter((cat) => cat["$"].domain=="category");
    const tagList = post.category.filter((cat) => cat["$"].domain=="post_tag");

    const categories = catList && catList.map((cat) => htmlentities.decode(cat["_"]));
    const tags = tagList && tagList.map((cat) => htmlentities.decode(cat["_"]));

    //Find all images
    let images = [];
    if (heroURLs.length > 0) {
        const url = heroURLs[0];
        [postData, images] = await processImage({
            url,
            postData,
            images,
            directory,
        });
    }

    [postData, images] = await processImages({ postData, directory });

    heroImage = images.find((img) => !img.endsWith("gif"));

    const markdown = await new Promise((resolve, reject) => {
        unified()
            .use(parseHTML, {
                fragment: true,
                emitParseErrors: true,
                duplicateAttribute: false,
            })
            .use(fixCodeBlocks)
            .use(fixEmbeds)
            .use(rehype2remark)
            .use(cleanupShortcodes)
            .use(stringify, {
                fences: true,
                listItemIndent: 1,
                gfm: false,
                pedantic: false,
            })
            .process(fixBadHTML(postData), (err, markdown) => {
                if (err) {
                    reject(err);
                } else {
                    let content = markdown.contents;
                    content = content.replace(
                        /(?<=https?:\/\/.*)\\_(?=.*\n)/g,
                        "_"
                    );
                    resolve(prettier.format(content, { parser: "mdx" }));
                }
            });
    });

    try {
        postTitle.replace("\\", "\\\\").replace(/"/g, '\\"');
    } catch (e) {
        console.log("FAILED REPLACE", postTitle);
    }

    const redirect_from = post.link[0]
        .replace("https://swizec.com", "")
        .replace("https://www.swizec.com", "");
    let frontmatter;
    try {
        frontmatter = [
            "---",
            `title: '${postTitle.replace(/'/g, "''")}'`,
            `description: "${description}"`,
            `published: ${format(postDate, "yyyy-MM-dd")}`,
            `type: posts`,
            `redirect_from:
            - ${redirect_from}`,
        ];
    } catch (e) {
        console.log("----------- BAD TIME", postTitle, postDate);
        throw e;
    }
    if (author) {
        frontmatter.push(`authors:`);
        frontmatter.push(`- ${author}`);
    }
    if (categories && categories.length > 0) {
        frontmatter.push("categories:");
        categories.forEach(element => {
            frontmatter.push(`- ${element}`);
        });
    }
    if (tags && tags.length > 0) {
        frontmatter.push("tags:");
        tags.forEach(element => {
            frontmatter.push(`- ${element}`);
        });
    }

    frontmatter.push(`hero: ${heroImage || "../../../defaultHero.jpg"}`);
    frontmatter.push("---");
    frontmatter.push("");

    fs.writeFile(
        `out/${directory}/${fname}`,
        frontmatter.join("\n") + markdown,
        function (err) {}
    );
}

async function downloadFile(url) {
    const response = await fetch(url);
    if (response.status >= 400) {
        throw new Error("Bad response from server");
    } else {
        return response;
    }
}
function getPaddedMonthNumber(month) {
    if (month < 10) return "0" + month;
    else return month;
}

function getPaddedDayNumber(day) {
    if (day < 10) return "0" + day;
    else return day;
}
