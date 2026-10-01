import { system, world } from "@minecraft/server";

let GlobalUIDatabase: any[] = [];
const TitleOption = { fadeInDuration: 0, fadeOutDuration: 0, stayDuration: 0 };

system.runInterval(() => {
    GlobalUIDatabase.forEach(e => e.renderUI());
});

export class UI {
    id: string;
    source: any;
    queue: any[];

    constructor(player: any) {
        this.id = player.id;
        this.source = player;
        this.queue = [];
        GlobalUIDatabase.push(this);
    }

    static getUI(player: any): UI {
        let data = GlobalUIDatabase.find((f: any) => f.id == player.id) as UI | undefined;
        if(!data) data = new UI(player);
            
        return data;
    }

    addUI(identifier: string, input: any): void {
        let data = this.queue.find((f: any) => f.id == identifier);
        let in_queue = true;
        if(data == undefined){
            data = { id: identifier };
            in_queue = false;
        }
        try{
            input = JSON.parse(input);
        } catch {}
        data.repetition = 3;
        if(typeof input === "number") input = input.toString();
        data.title = input;
        if(!in_queue) this.queue.push(data);
    }

    addUISub(identifier: string, input: any): void {
        let data = this.queue.find((f: any) => f.id == identifier);
        let in_queue = true;
        if(data == undefined){
            data = { id: identifier };
            in_queue = false;
        }
        try{
            input = JSON.parse(input);
        } catch {}
        data.repetition = 3;
        if(typeof input === "number") input = input.toString();
        data.sub = input;
        if(!in_queue) this.queue.push(data);
    }

    renderUI(): void {
        if(this.queue.length == 0) return;

        let current = this.queue.shift() as any;
        
        if(current.title != undefined){
            let option: any = { ...TitleOption };
            option.subtitle = current.sub;
            this.source.onScreenDisplay.setTitle(current.title, option);
        }

        if(current.repetition > 0){
            current.repetition -= 1;
            this.queue.push(current);
        }
    }

    remove(): void {
        GlobalUIDatabase = GlobalUIDatabase.filter(f => f.id != this.id);
        this.queue = [];
        this.source = null;
    }
}

export function handleUILoadOld(s: any): void {
	if(s.id != "ui:set") return;
    const ui_data = UI.getUI(s.sourceEntity);
    const data = s.message.split(" ");
    const identifier = data[1];
    ui_data.addUI(identifier, s.message.replace(" ", ""));
}

export function handleUILoadLegacy(s: any): void {
    const ui_data = UI.getUI(s.sourceEntity);
    const identifier = s.id.split(":")[1];
    ui_data.addUI(identifier, s.message);
}

export function handleUISubLoadLegacy(s: any): void {
    const ui_data = UI.getUI(s.sourceEntity);
    const identifier = s.id.split(":")[1];
    ui_data.addUISub(identifier, s.message);
}

export function handleUILoad(s: any): void {
    const data = s.message.split("|");
    const ui_data = UI.getUI(world.getEntity(data[0]));
    const identifier = s.id.split(":")[1];
    ui_data.addUI(identifier, s.message.substring(data[0].length + 1));
}

export function handleUISubLoad(s: any): void {
    const data = s.message.split("|");
    const ui_data = UI.getUI(world.getEntity(data[0]));
    const identifier = s.id.split(":")[1];
    ui_data.addUISub(identifier, s.message.substring(data[0].length + 1));
}

export function handlePlayerJoin(s: any): void {
    if(!s.initialSpawn) return;
    if(!UI.getUI(s.player)) new UI(s.player);
}

export function handleWorldLoad(): void {
    world.getPlayers().forEach(player =>{ 
        if(!UI.getUI(player)) new UI(player);
    });
}

export function handlePlayerLeave(s: any): void {
    UI.getUI(s.player).remove();
}