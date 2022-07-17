//=============================================================================
// RPG Maker MZ - planckMZ
//=============================================================================

/*:
 * @target MZ
 * @plugindesc planck.js をRPGツクールMZで動作させる
 * @author 綱兵
 * 
 * @param DefaultGravity
 * @text 初期重力設定
 * @desc ゲーム起動時の物理演算の初期重力設定。(初期：0.0, 3.0)
 * @default 0.0, 3.0
 * 
 * @param DebugCollideDisplay
 * @text 当たり判定可視化
 * @desc 生成ボディと通行不可タイルの当たり判定を可視化する。
 * @default false
 * @type boolean
 * 
 * @param DebugGravityDisplay
 * @text 重力を画面に表示
 * @desc 物理演算ワールドの重力を画面左上に表示する。
 * @default false
 * @type boolean
 *
 * @help planckMZ.js
 *
 * 物理演算プラグイン planck.js をRPGツクールMZで動作させるための
 * 外部プラグインです。
 * 別途 planck.js をプラグインリストでオンにする必要があります。
 * 
 * ※内包してある planck.js はいくつかの箇所に追記があるので
 * 本体のバージョン変更の際は注意してください。
 */

(() => {
    "use strict";
    let planckMZ_Param = PluginManager.parameters(document.currentScript.src.split("/").pop().replace(/\.js$/, ""));
    let DefaultGravity = planckMZ_Param["DefaultGravity"].split(",");
    let DebugCollideDisplay = planckMZ_Param["DebugCollideDisplay"] === "true" || false;
    let DebugGravityDisplay = planckMZ_Param["DebugGravityDisplay"] === "true" || false;

    ////////////////////////////////////////////////////////////////////////
    //                             数値関数                                //
    ////////////////////////////////////////////////////////////////////////


    //pixiのX,Y座標からplanckのX,Y座標への変換
    Math.ToPlanck = function (x, y) {
        //convert pixels to meters (64px = 0.1m)
        x *= 0.0015625;
        y *= 0.0015625;
        return planck.Vec2(x, y);
    }


    //pixiの大きさからplanckの大きさへの変換
    Math.ToPlanckValue = function (value) {
        return value *= 0.0015625;
    }


    //planckのX,Y座標からpixiのX,Y座標への変換
    Math.ToPixi = function (array) {
        //convert pixels to meters (64px = 0.1m)
        let retX = array.x * 640;
        let retY = array.y * 640;
        return { x: retX, y: retY };
    }


    //planckの大きさからpixiの大きさへの変換
    Math.ToPixiValue = function (value) {
        return value * 640;
    }


    //planck.js用に四角形のサイズ変換
    Math.To2dBox = function (value) {
        return value / 2 - 0.0095;
    }


    //planck.js多角形用のサイズ変換
    Math.To2dPolygon = function (x, y) {
        if (x > 0) { x -= 8; }
        if (x < 0) { x += 8; }
        if (y > 0) { y -= 5; }
        if (y < 0) { y += 5; }
        return Math.ToPlanck(x, y);
    }


    //小数点含めた乱数生成
    Math.randomFloat = function (min, max) {
        return (Math.random() * (max - min)) + min;
    };


    ////////////////////////////////////////////////////////////////////////
    //                          物理演算ワールド設定                        //
    ////////////////////////////////////////////////////////////////////////


    //物理演算ワールドの更新処理追記
    let Game_Map_prototype_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        this.worldsetup();
        this.updatePlanck();
        this.updateCollider();
        Game_Map_prototype_update.call(this, sceneActive);
    };


    //物理演算ワールドが存在する場合は更新処理
    Game_Map.prototype.updatePlanck = function () {
        if (this.world) {
            let timeStep = 1 / 60;
            let velocityIterations = 6;
            let positionIterations = 2;
            this.world.step(timeStep, velocityIterations, positionIterations);
        }
    };


    //マップの初期設定に追記
    let Game_Map_prototype_setup = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function (mapId) {
        Game_Map_prototype_setup.call(this, mapId);
        this.worldsetup();
    };


    //シーン切り替えの時にデバッグ用重力表示を更新
    let Scene_Base_prototype_popScene = Scene_Base.prototype.popScene;
    Scene_Base.prototype.popScene = function () {
        Scene_Base_prototype_popScene.call(this);
        if ($gameMap.world) {
            $gameMap.world.refreshDisplayGravity = true;
        }
    };


    //マップ開始時に物理演算ワールドを設定
    Game_Map.prototype.worldsetup = function () {
        if (this.world) {
            if (this.world.mapId == this._mapId) {
                return;
            }
            this.world = null;
        }
        //重力設定
        this.world = planck.World({
            gravity: planck.Vec2(0.0, 0.0),
        });
        this.world.mapId = this._mapId;
        //マップメモ欄またはプラグインパラメータから初期重力を設定
        let gravity = $dataMap.meta["重力"] ? $dataMap.meta["重力"].split(",") : DefaultGravity;
        this.setGravity({ x: Number(gravity[0]), y: Number(gravity[1]) });
        //通行不可タイル、マップ外の壁を生成
        this.createWallandCollisionTile();
    };


    //物理演算の重力を設定
    Game_Map.prototype.setGravity = function (vec) {
        this.world.setGravity(vec);
        //反発吸収値の設定
        planck.internal.Settings.velocityThreshold = vec.x + vec.y >= -0.1 && vec.x + vec.y <= 0.1 ? 0 : 0.9;
        //静止している物体が動かないことがあるので対策
        for (let body = this.world.getBodyList(); body; body = body.getNext()) {
            body.applyForceToCenter(planck.Vec2(Math.randomFloat(-0.001, 0.001), Math.randomFloat(-0.001, 0.001)), true);
        }
        //デバッグ用の更新指示
        this.world.refreshDisplayGravity = true;
    }


    //マップに当たり判定付きの四角形を生成
    Game_Map.prototype.createBox = function (rect) {
        let size = Math.ToPlanck(rect.w * 48, rect.h * 48);
        let pos = Math.ToPlanck(rect.x * 48, rect.y * 48);
        let groundBodyDef = { position: planck.Vec2(pos.x + size.x / 2, pos.y + size.y / 2), };
        let groundBody = this.world.createBody(groundBodyDef);
        let groundBox = planck.Box(Math.To2dBox(size.x), Math.To2dBox(size.y));
        let fixtureDef = {
            shape: groundBox,
            friction: 0.1,
            restitution: 0.9,
        }
        groundBox.m_size = size;
        groundBox.Shapecategory = "box";
        groundBody.ID = 0;
        groundBody.createFixture(fixtureDef, 0.0);
    }


    //マップ外に壁と通行不可を生成する
    Game_Map.prototype.createWallandCollisionTile = function () {
        //画面外の壁
        let rectlist = [
            { x: -2, y: -2, w: $dataMap.width + 4, h: 2 }, //上
            { x: -2, y: $dataMap.height, w: $dataMap.width + 4, h: 2 }, //下
            { x: -2, y: -2, w: 2, h: $dataMap.height + 4 }, //左
            { x: $dataMap.width, y: -2, w: 2, h: $dataMap.height + 4 }  //右
        ];
        //通行不可タイル
        rectlist = rectlist.concat(this.collisionRects().tiles);

        for (let i = 0; i < rectlist.length; i++) {
            this.createBox(rectlist[i]);
        }
    }


    //参考元：ふしぎうさぎさん
    Game_Map.prototype.collisionRects = function () {
        let tiles = [];
        let tops = [];
        let bottoms = [];
        let lefts = [];
        let rights = [];
        for (let y = 0; y < this.height(); y++) {
            for (let x = 0; x < this.width(); x++) {
                if (this.isCollisionTile(x, y)) {
                    tiles.push({ x: x, y: y });
                    continue;
                }
                if (this.isCollisionSide(x, y, 2)) {
                    bottoms.push({ x: x, y: y });
                }
                if (this.isCollisionSide(x, y, 8)) {
                    tops.push({ x: x, y: y });
                }
            }
        }

        for (let x = 0; x < this.width(); x++) {
            for (let y = 0; y < this.height(); y++) {
                if (this.isCollisionTile(x, y)) {
                    continue;
                }
                if (this.isCollisionSide(x, y, 4)) {
                    lefts.push({ x: x, y: y });
                }
                if (this.isCollisionSide(x, y, 6)) {
                    rights.push({ x: x, y: y });
                }
            }
        }

        return {
            tiles: this.margeVerticalRects(this.margeHorizontalTiles(tiles)),
            tops: this.margeHorizontalTiles(tops),
            bottoms: this.margeHorizontalTiles(bottoms),
            lefts: this.margeVerticalTiles(lefts),
            rights: this.margeVerticalTiles(rights)
        };
    };


    Game_Map.prototype.margeHorizontalTiles = function (tiles) {
        let list = [];
        tiles.forEach(function (tile) {
            if (list.length == 0) {
                list.push({ x: tile.x, y: tile.y, w: 1, h: 1 });
                return;
            }
            const rect = list[list.length - 1];
            if (rect.y == tile.y && rect.x + rect.w == tile.x) {
                rect.w += 1;
            } else {
                list.push({ x: tile.x, y: tile.y, w: 1, h: 1 });
            }
        }, this);
        return list;
    };


    Game_Map.prototype.margeVerticalTiles = function (tiles) {
        let list = [];
        tiles.forEach(function (tile) {
            if (list.length == 0) {
                list.push({ x: tile.x, y: tile.y, w: 1, h: 1 });
                return;
            }
            const rect = list[list.length - 1];
            if (rect.x == tile.x && rect.y + rect.h == tile.y) {
                rect.h += 1;
            } else {
                list.push({ x: tile.x, y: tile.y, w: 1, h: 1 });
            }
        }, this);
        return list;
    };


    Game_Map.prototype.margeVerticalRects = function (rects) {
        let list = [];
        for (let i = 0; i < rects.length; i++) {
            this.margeRectList(rects[i], list);
        }
        return list;
    };


    Game_Map.prototype.isCollisionTile = function (x, y) {
        return !(this.isPassable(x, y, 2) || this.isPassable(x, y, 4) || this.isPassable(x, y, 6) || this.isPassable(x, y, 8));
    };


    Game_Map.prototype.isCollisionSide = function (x, y, side) {
        return !this.isPassable(x, y, side);
    };


    Game_Map.prototype.margeRectList = function (node, list) {
        for (let i = list.length - 1; i >= 0; i--) {
            const rect = list[i];
            if (rect.y + rect.h == node.y) {
                if (node.x <= rect.x && rect.x + rect.w <= node.x + node.w) {
                    //rectに接続
                    rect.h += 1;
                    //はみ出し分
                    let tmps = [];
                    //左側
                    if (node.x < rect.x) {
                        tmps.push({ x: node.x, y: node.y, w: rect.x - node.x, h: 1 });
                    }
                    //右側
                    if (rect.x + rect.w < node.x + node.w) {
                        tmps.push({ x: rect.x + rect.w, y: node.y, w: node.x + node.w - rect.x - rect.w, h: 1 });
                    }
                    for (let j = 0; j < tmps.length; j++) {
                        this.margeRectList(tmps[j], list);
                    }
                    return;
                }
            }
        };
        //接続なし
        list.push({ x: node.x, y: node.y, w: node.w, h: node.h });
    };


    ////////////////////////////////////////////////////////////////////////
    //                           物理演算キャラ設定                         //
    ////////////////////////////////////////////////////////////////////////


    //イベントの条件分岐のスクリプトを改変
    let Game_Interpreter_prototype_command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function (params) {
        if (params[0] == 12) {
            return this.command111plus(params);
        }
        return Game_Interpreter_prototype_command111.call(this, params);
    }


    //イベントの条件分岐のスクリプトを改変
    Game_Interpreter.prototype.command111plus = function (params) {
        let result;
        switch (params[1]) {
            case "ボディ未生成": result = $gameMap.event(this._eventId).EventCreateBodyCheck(); break;
            default: result = !!eval(params[1]); break;
        }
        this._branch[this._indent] = result;
        if (this._branch[this._indent] === false) {
            this.skipBranch();
        }
        return true;
    };


    //イベントのボディ生成するかチェック
    Game_Character.prototype.EventCreateBodyCheck = function () {
        if (!$gameMap.world) { return false; }
        return this.body == null;
    }


    //イベントのボディ生成
    Game_Character.prototype.CreateBody = function (data) {
        let charapos = Math.ToPlanck(this._realX * 48, this._realY * 48);
        this.body = $gameMap.world.createBody({
            type: data.type,
            position: planck.Vec2(charapos.x, charapos.y),
            linearDamping: 1.5,
            angularDamping: 1
        });
        let shape;
        if (data.shape == "box") {
            let size = Math.ToPlanck(data.shapeSize[0], data.shapeSize[1]);
            shape = planck.Box(Math.To2dBox(size.x), Math.To2dBox(size.y));
            shape.m_size = size;
        }
        if (data.shape == "circle") {
            shape = planck.Circle(Math.ToPlanckValue(data.shapeSize), planck.Vec2(0, 0));
        }
        if (data.shape == "polygon") {
            shape = planck.Polygon(data.shapeSize);
        }
        shape.Shapecategory = data.shape;
        let fixtureDef = {
            shape: shape,
            density: data.density || 0,
            friction: data.friction || 0.2,
            restitution: data.restitution || 0,
            isSensor: data.isSensor || false,
            filterGroupIndex: data.filterGroupIndex || undefined
        }
        this.body.createFixture(fixtureDef);
        this.body.ID = this._eventId;
        this.body.collideTemp = [];
        this.body.collideTrigger = [];
        this.body.collideActive = [];
        if (data.origin) {
            this.setOrigin(data.origin[0], data.origin[1]);
        }
        this.shiftY = function () {
            return 0;
        };
    }


    //キャラクターupdateの書き換え
    let Game_CharacterBase_prototype_update = Game_CharacterBase.prototype.update;
    Game_CharacterBase.prototype.update = function () {
        if (this.body) {
            if (this.isStopping()) {
                this.updateStop();
            }
            this.updateAnimation();
            this.updatePlanckMove();
            this.updateCollider();
            return;
        }
        Game_CharacterBase_prototype_update.call(this);
    };


    //キャラクターがbodyを持っている場合、planckの位置更新に切り替え
    Game_CharacterBase.prototype.updatePlanckMove = function () {
        let pos = Math.ToPixi(this.body.getPosition());
        this._x = this._realX = pos.x / 48;
        this._y = this._realY = pos.y / 48;
        this.setAngle(this.body.getAngle() * (180 / Math.PI));
    };


    //キャラクターの回転設定
    Game_CharacterBase.prototype.setAngle = function (angle) {
        this._angle = angle;
    };


    //キャラクターの回転取得
    Game_CharacterBase.prototype.angle = function () {
        return this._angle;
    };


    //キャラクターの中心点設定
    Game_CharacterBase.prototype.setOrigin = function (x, y) {
        this._originX = x / 100;
        this._originY = y / 100;
    };


    //キャラクターのX中心点取得
    Game_CharacterBase.prototype.originX = function () {
        return this._originX;
    };


    //キャラクターのY中心点取得
    Game_CharacterBase.prototype.originY = function () {
        return this._originY;
    };


    //キャラクターのスプライト更新に追記
    const Sprite_Character_updateBitmap = Sprite_Character.prototype.updateBitmap;
    Sprite_Character.prototype.updateBitmap = function () {
        Sprite_Character_updateBitmap.apply(this, arguments);
        this.updateAngle();
        this.updateOrigin();
        this.updateBitmapSize();
    };


    //キャラクターの回転に合わせスプライト更新
    Sprite_Character.prototype.updateBitmapSize = function () {
        if (this.bitmap) {
            this._character.bitmapWidth = this.patternWidth();
            this._character.bitmapHeight = this.patternHeight();
        }
    }


    //キャラクターの回転に合わせスプライト更新
    Sprite_Character.prototype.updateAngle = function () {
        const angle = this._character.angle() * Math.PI / 180;
        if (angle && this.rotation !== angle) this.rotation = angle;
    };


    //キャラクターの回転に合わせスプライト更新
    Sprite_Character.prototype.updateOrigin = function () {
        const originX = this._character.originX();
        if (originX != null) this.anchor.x = originX;
        const originY = this._character.originY();
        if (originY != null) this.anchor.y = originY;
    }


    //ボディの保有に合わせて位置調整
    const Game_CharacterBase_screenX = Game_CharacterBase.prototype.screenX;
    Game_CharacterBase.prototype.screenX = function () {
        return Game_CharacterBase_screenX.apply(this, arguments) - (this.body ? 24 : 0);
    };


    //ボディの保有に合わせて位置調整
    const Game_CharacterBase_screenY = Game_CharacterBase.prototype.screenY;
    Game_CharacterBase.prototype.screenY = function () {
        return Game_CharacterBase_screenY.apply(this, arguments) - (this.body ? 48 : 0);
    };


    ////////////////////////////////////////////////////////////////////////
    //                           物理演算当たり判定                         //
    ////////////////////////////////////////////////////////////////////////


    //衝突判定更新
    Game_Map.prototype.updateCollider = function () {
        let bodyA, bodyB;
        //衝突判定があるもの同士
        for (let contact = this.world.getContactList(); contact != null; contact = contact.getNext()) {
            if (!contact.isTouching()) { continue; }
            bodyA = contact.getFixtureA().getBody();
            bodyB = contact.getFixtureB().getBody();
            if (bodyA.ID && bodyA.ID >= 1 && bodyB.ID != undefined) {
                if (!bodyA.collideTemp.includes(bodyB.ID)) {
                    bodyA.collideTemp.push(bodyB.ID);
                }
            }
            if (bodyB.ID && bodyB.ID >= 1 && bodyA.ID != undefined) {
                if (!bodyB.collideTemp.includes(bodyA.ID)) {
                    bodyB.collideTemp.push(bodyA.ID);
                }
            }
        }
        //フィルター機能で衝突判定がないもの同士
        for (bodyA = this.world.getBodyList(); bodyA; bodyA = bodyA.getNext()) {
            let fixtureA = bodyA.getFixtureList();
            if (!fixtureA.getFilterGroupIndex()) { continue; }
            if (fixtureA.getFilterGroupIndex() > 0) { continue; }
            for (bodyB = this.world.getBodyList(); bodyB; bodyB = bodyB.getNext()) {
                if (bodyA.ID == undefined || bodyB.ID == undefined) { continue; }
                if (bodyA.ID == bodyB.ID) { continue; }
                let fixtureB = bodyB.getFixtureList();
                if (fixtureA.getFilterGroupIndex() != fixtureB.getFilterGroupIndex()) { continue; }
                let shapeA = fixtureA.getShape();
                let shapeB = fixtureB.getShape();
                let xfA = bodyA.getTransform();
                let xfB = bodyB.getTransform();
                if ($gameMap.testOverlap(shapeA, 0, shapeB, 0, xfA, xfB)) {
                    if (!bodyA.collideTemp.includes(bodyB.ID)) {
                        bodyA.collideTemp.push(bodyB.ID);
                    }
                    if (!bodyB.collideTemp.includes(bodyA.ID)) {
                        bodyB.collideTemp.push(bodyA.ID);
                    }
                }
            }
        }
    }


    //キャラクターがbodyを持っている場合、衝突判定更新
    Game_CharacterBase.prototype.updateCollider = function () {
        this.body.collideTrigger = this.body.collideTemp.filter(n => !this.body.collideActive.includes(n));
        this.body.collideActive = this.body.collideTemp;
        this.body.collideTemp = [];
    };


    ////////////////////////////////////////////////////////////////////////
    //                           物理演算セーブ機能                         //
    ////////////////////////////////////////////////////////////////////////


    //循環参照回避
    DataManager.makeSaveContents = function () {
        const contents = {};
        contents.system = $gameSystem;
        contents.screen = $gameScreen;
        contents.timer = $gameTimer;
        contents.switches = $gameSwitches;
        contents.variables = $gameVariables;
        contents.selfSwitches = $gameSelfSwitches;
        contents.actors = $gameActors;
        contents.party = $gameParty;

        let mapdata = DeepCopy($gameMap);

        //物理演算ワールド情報をセーブデータには保管しない
        if (mapdata.world) {
            mapdata.world = null;
        }
        //物理演算キャラクター情報をセーブデータには保管しない
        for (let i = 0; i < mapdata._events.length; i++) {
            let event = mapdata._events[i];
            if (!event) { continue; }
            if (!event.body) { continue; }
            event.body = null;
        }
        //GALV_CamControl.jsの競合回避
        if (mapdata.camTarget) {
            mapdata.camTarget = null;
        }

        contents.map = mapdata;

        //物理演算プレイヤーキャラ情報をセーブデータには保管しない
        let playerdata = DeepCopy($gamePlayer);
        playerdata.body = null;
        contents.player = playerdata;

        return contents;
    };


    ////////////////////////////////////////////////////////////////////////
    //                             デバッグ用                              //
    ////////////////////////////////////////////////////////////////////////


    let Spriteset_Map_prototype_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function () {
        if ($gameMap.world) {
            this.PlanckRender();
            this.DisplayGravity();
        }
        Spriteset_Map_prototype_update.call(this);
    };


    Spriteset_Map.prototype.PlanckRender = function () {
        if (!DebugCollideDisplay) { return; }
        this.createPlanckRender();
        for (let body = $gameMap.world.getBodyList(); body; body = body.getNext()) {
            let fixture = body.getFixtureList();
            let pos = Math.ToPixi(body.getPosition());
            pos.x -= $gameMap._displayX * 48;
            pos.y -= $gameMap._displayY * 48;
            if (fixture._Render && fixture._Render.transform) {
                fixture._Render.rotation = body.getAngle();
                fixture._Render.x = pos.x;
                fixture._Render.y = pos.y;
                continue;
            }
            let shape = fixture.getShape();
            if (shape.Shapecategory == "circle") {
                let radius = Math.ToPixiValue(shape.m_radius);
                let sprite = new Sprite(new Bitmap(radius * 2, radius * 2));
                sprite.bitmap.drawCircle(radius, radius, radius, "rgb(255, 0, 0)");
                sprite.x = pos.x;
                sprite.y = pos.y;
                sprite.pivot.x = sprite.width / 2;
                sprite.pivot.y = sprite.height / 2;
                sprite.opacity = 128;
                fixture._Render = this._PlanckRender.addChild(sprite);
            }
            if (shape.Shapecategory == "box") {
                let size = Math.ToPixi(shape.m_size);
                let sprite = new Sprite(new Bitmap(size.x, size.y));
                sprite.bitmap.fillRect(0, 0, size.x, size.y, "rgb(255, 0, 0)");
                sprite.x = pos.x;
                sprite.y = pos.y;
                sprite.pivot.x = sprite.width / 2;
                sprite.pivot.y = sprite.height / 2;
                sprite.opacity = 128;
                fixture._Render = this._PlanckRender.addChild(sprite);
            }
            if (shape.Shapecategory == "polygon") {
                let graphics = new PIXI.Graphics();
                graphics.alpha = 0.5;
                let vertex = DeepCopy(shape.m_vertices);
                for (let i = 0; i < vertex.length; i++) {
                    vertex[i] = Math.ToPixi(vertex[i]);
                    if (vertex[i].x > 0) { vertex[i].x += 8; }
                    if (vertex[i].x < 0) { vertex[i].x -= 8; }
                    if (vertex[i].y > 0) { vertex[i].y += 5; }
                    if (vertex[i].y < 0) { vertex[i].y -= 5; }
                }
                graphics.beginFill(0xff0000);
                graphics.moveTo(vertex[0].x, vertex[0].y);
                for (let i = 1; i < vertex.length; i++) {
                    graphics.lineTo(vertex[i].x, vertex[i].y);
                }
                graphics.endFill();
                fixture._Render = this._PlanckRender.addChild(graphics);
            }
        }
    }


    Spriteset_Map.prototype.createPlanckRender = function () {
        if (!this._PlanckRender) {
            this._PlanckRender = new Sprite(new Bitmap(Graphics.width, Graphics.height));
            this._tilemap.addChild(this._PlanckRender);
        }
    };


    //現在のワールド重力を画面に表示
    Spriteset_Map.prototype.DisplayGravity = function () {
        if (!DebugGravityDisplay) { return; }
        let world = $gameMap.world;
        if (!world) { return; }
        if (!world.refreshDisplayGravity) { return; }
        if (this.gravityText) {
            this.removeChild(this.gravityText);
        }
        let gravity = world.getGravity();
        let x = Math.round((gravity.x * 10)) / 10;
        let y = Math.round((gravity.y * 10)) / 10;
        this.gravityText = new Window_Base(new Rectangle(10, 10, 320, 58));
        this.gravityText.opacity = 0;
        this.gravityText.drawTextEx("\\FS[21]【重力】 x: " + x + "  y: " + y, 0, 0);
        this.addChild(this.gravityText);
        world.refreshDisplayGravity = null;
    }


})();
