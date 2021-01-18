const exec = require("child_process").execSync;
const cron = require("node-cron");
const axios = require("axios");
const fs = require("fs");
const smartReplace = require("./smartReplace");

//#region 全局变量

let CRONTAB = process.env.CRONTAB; //请填写五位或六位的调度命令,这里的时间使用北京时间即可

let ACTIONS_TRIGGER_TOKEN = process.env.ACTIONS_TRIGGER_TOKEN; //Personal access tokens，申请教程:https://www.jianshu.com/p/bb82b3ad1d11 记得勾选repo权限就行
let TRIGGER_KEYWORDS = process.env.TRIGGER_KEYWORDS || "schedule"; //.github/workflows/路径里面yml文件里面repository_dispatch项目的types值，例如jd_fruit.yml里面的值为fruit
let GITHUBUSER = process.env.GITHUBUSER; //github用户名，例:lxk0301
let REPO = process.env.REPO; //需要触发的 Github Action 所在的仓库名称 例:scripts

let LONG_TIME_TRIGGER = process.env.LONG_TIME_TRIGGER == "true"; //用于判断脚本是否需要长时间执行,如果不需要记得在yaml中配置timeout-minutes
let RUN_END_TIME = new Date().getTime() + 1000 * 60 * 358; //用于记录脚本结束时间,以配合LONG_TIME_TRIGGER实现持续唤醒

let REMOTE_CONTENT = "";
//#endregion

//#region 需要自行配置执行的地方

if (!CRONTAB) {
    console.log("没有配置定时命令[CRONTAB]，不执行任何操作");
    return;
}

if (!process.env.SYNCURL) {
    console.log("没有配置定时执行的链接[SYNCURL]，不执行任何操作");
    return;
}

var my_schedule = cron.schedule(
    CRONTAB,
    () => {
        console.log(`北京时间 (UTC+08)：${new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toLocaleString()}}`);
        //每次运行前,检测之前的是否存在,存在的话则清理掉
        if (my_schedule) my_schedule.stop();
        t();
    },
    { timezone: "Asia/Shanghai" }
);
async function t() {

    try {
        if (!REMOTE_CONTENT) {
            changeFile();
        }
        await exec("node executeOnce.js", { stdio: "inherit" });
    } catch (e) {
        console.log("执行异常:" + e);
    }
}
async function changeFile() {
    let response = await axios.get(process.env.SYNCURL);
    let content = response.data;
    REMOTE_CONTENT = await smartReplace.inject(content);
    await fs.writeFileSync("./executeOnce.js", REMOTE_CONTENT, "utf8");
    console.log("替换变量完毕");
}
//#endregion

//#region Github Actions持续唤醒
//一个每半分钟执行一次的job,用于判断是否即将到达执行超时时间

if (LONG_TIME_TRIGGER) {
    var rebirth = cron.schedule("0/30 * * * * *", () => {
        var now_time = new Date().getTime();
        if (now_time >= RUN_END_TIME) {
            hook(TRIGGER_KEYWORDS).then((res) => {
                if (res == 1) {
                    console.log("唤醒脚本"+TRIGGER_KEYWORDS+"成功");
                    //stop this schedule and kill the process
                    //hook(TRIGGER_KEYWORDS);
                    rebirth.stop();
                } else {
                    console.log("尝试唤醒新的脚本失败,稍后可能会进行重试");
                }
            });
        }
    });
}

function hook(event_type) {
    const options = {
        url: `https://api.github.com/repos/${GITHUBUSER}/${REPO}/dispatches`,
        body: `${JSON.stringify({ event_type: event_type })}`,
        headers: {
            Accept: "application/vnd.github.everest-preview+json",
            Authorization: `token ${ACTIONS_TRIGGER_TOKEN}`,
        },
    };
    return new Promise((resolve) => {
        const { url, ..._opts } = options;
        require("got")
            .post(url, _opts)
            .then(
                (resp) => {
                    // const { statusCode: status, statusCode, headers, body } = resp;
                    // callback(null, { status, statusCode, headers, body }, body);
                    console.log(`触发[${event_type}]成功`);
                    resolve(1);
                },
                (err) => {
                    const { message: error, response: resp } = err;
                    // callback(error, resp, resp && resp.body);
                    var data = resp && resp.body;
                    if (data && data.match("404")) {
                        console.log(`触发[${event_type}]失败,请仔细检查提供的参数`);
                        resolve(2);
                    } else if (data && data.match("401")) {
                        console.log(`触发[${event_type}]失败,github token权限不足`);
                        resolve(3);
                    } else {
                        console.log("失败", `${JSON.stringify(error)}`);
                        resolve(4);
                    }
                }
            );
    });
}

//#endregion
