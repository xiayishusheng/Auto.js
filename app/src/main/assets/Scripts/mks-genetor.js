auto();

toast("开始运行");

let addScriptUrl = 'http://10.200.10.8:8001/script/add';
let saveScriptUrl = 'http://10.200.10.8:8001/script/save';
let getAppInfoUrl = 'http://10.200.10.8:8001/app/info';

//是否开始记录脚本
let flag = false;
let rsTemp = {};
let preStep = null;

//滑动事件坐标点数组
let points = [];
let beginTime = 0;
let preTime = 0;

//ID
let idCount = 0;

let appid = null;
let isFirst = null;
// 屏蔽按键原有的功能
events.setKeyInterceptionEnabled("volume_up", true);
events.setKeyInterceptionEnabled("volume_down", true);

events.observeKey();
events.on("key", function (keyCode, event) {
    //处理按键按下事件
    if (keyCode == keys.volume_up && event.getAction() == event.ACTION_UP) {
        if (!flag) {
            appid = rawInput("app 的 id ", "1");
            if (appid == null) return;

            // 获取app信息
            let infoRet;
            try {
                infoRet = http.post(getAppInfoUrl, { id: appid });
            } catch (err) {
                log("获取app信息失败");
                alert("或app信息失败，请重新开始");
                return;
            }

            let infoBody = JSON.parse(infoRet.body.string());
            log(infoBody);

            let appInfo;
            if (infoBody.code == 1) {
                appInfo = infoBody.app;
            }

            // isFirst = rawInput("isFirst", "1");
            isFirst = dialogs.singleChoice("首次打开" + appInfo.pkgName, ['否', '是'], 1);
            if (isFirst == null || isFirst == -1) return;

            log("appid = " + appid + ", isFirst = " + isFirst);

            toast("正在打开: " + appInfo.pkgName);
            openApp(appInfo);

            if (appid != null && isFirst != null) {
                toast("3秒后开始记录");
                setTimeout(() => {
                    recordBegin();
                }, 3000);
            }
        } else {
            toast("正在录制中!");
        }
    } else if (keyCode == keys.volume_down && event.getAction() == event.ACTION_UP) {
        if (flag) {
            events.removeAllTouchListeners();
            console.log('生成操作脚本...');
            console.log(rsTemp);
            try {
                addscript(JSON.stringify(rsTemp));
            } catch (err) {
                alert(err);
            }

            // 重置
            rsTemp = {};
            flag = false;
            idCount = 0;
            appid = null;
            isFirst = null;
            preStep = null;
        } else {
            log("尚未开始录制!");
        }
    } else if (keyCode == keys.back && event.getAction() == event.ACTION_UP) {
        if (flag) {
            log("BACK");
            idCount++;
            let currentTime = new Date().getTime();
            let minTime = currentTime - preTime;
            preTime = currentTime;
            let step = {
                id: idCount,
                event: "BACK",
                time: {
                    "min": minTime,
                    "max": (minTime + 1000)
                },
                nexts: []
            };

            if (preStep) {
                step.pre = preStep.id;
                preStep.nexts.push(idCount);
            }
            preStep = step;
            rsTemp[idCount] = step;
        }
    }

});

// 提交到服务端
function addscript(script) {
    let r = http.post(addScriptUrl, { appid: appid, type: isFirst, script: script });
    let rs = JSON.parse(r.body.string());

    if (rs.code == 1) {
        log(rs);

        // 保存monkey脚本
        let path = "/sdcard/monkey.script";
        let file = open(path, "w");
        file.write(rs.monkey);
        file.close();

        let check = dialogs.confirm("验证脚本是否正确", "");
        log("验证: " + check);

        if (!check) return;

        // 验证脚本
        let scriptId = rs.id;

        toast("开始验证");
        openApp(rs);
        sleep(500);

        shell("monkey -f " + path + " 1", true);
        sleep(1000);

        // 确认是否正确
        let params = {};
        params.id = scriptId;

        let right = dialogs.confirm("脚本是否正确", "");
        if (right) {
            params.save = 1;
        } else {
            params.save = 0;
        }

        let ret = http.post(saveScriptUrl, params);
        log(ret);
        let result = JSON.parse(ret.body.string());
        log(result);

        log("正确: " + right);
        if (right && result.code == 1) {
            alert("保存成功");
        } else {
            toast("取消");
        }
    } else {
        alert(rs.msg);
    }
}

//开始记录
function recordBegin() {
    flag = true;
    console.log('开始记录操作...');
    toast("开始记录");
    // 开始录制的时间
    beginTime = new Date().getTime();
    preTime = new Date().getTime();

    //注册触摸监听器
    events.observeTouch();
    events.setTouchEventTimeout(100);
    events.onTouch(function (p) {
        let currentTime = new Date().getTime();
        // 打印触摸点坐标
        log(currentTime / 1000 + ", " + p);

        let minTime = currentTime - preTime;
        preTime = currentTime;

        points.push(p);
        idCount++;
        let step = null;
        if (points.length > 1) {//拖拽事件
            step = {
                id: idCount,
                event: "DRAG",
                time: {
                    "min": minTime,
                    "max": (minTime + 1000)
                },
                location: {
                    "x1": points[0].x,
                    "y1": points[0].y,
                    "x2": points[points.length - 1].x,
                    "y2": points[points.length - 1].y
                },
                nexts: [],
            };
        } else {//点击事件
            step = {
                id: idCount,
                event: "CLICK",
                time: {
                    "min": minTime,
                    "max": (minTime + 1000)
                },
                location: {
                    "x": p.x,
                    "y": p.y,
                    "offsetx": 30,
                    "offsety": 5
                },
                nexts: [],
            };
        }

        if (preStep) {
            step.pre = preStep.id;
            preStep.nexts.push(idCount);
        }

        preStep = step;
        rsTemp[idCount] = step;
        points = [];
    });
}

// 打开指定App
function openApp(app) {
    KeyCode("KEYCODE_HOME");// 按下Home键
    let cmd;
    if (isFirst == 1) {
        cmd = "pm clear " + app.pkgName;
        shell(cmd, true);
    } else {
        cmd = "am force-stop " + app.pkgName;
        shell(cmd, true);
    }

    cmd = "am start -n " + app.pkgName + "/" + app.startClass;
    shell(cmd, true);
}

events.on("exit", () => {
    events.removeAllTouchListeners();
    log("===结束===");
})