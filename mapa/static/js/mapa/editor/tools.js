import { Actions } from './action.js';

export class Holdable {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static object = null;
    static type = "";
    static initialPos = null;
    static phantomObject = null;

    static set(object, type = "", initialPos = false, phantomObject = false) {
        if (this.phantomObject) {
            this.phantomObject.destroy();
        }

        this.object = object;
        this.type = type;
        this.initialPos = initialPos;
        this.phantomObject = phantomObject;
    }
}

export class Task {
    constructor() {
        throw new Error("Classe estática. Não instancie.");
    }
    static task = "";
    static taskStep = 0;
    static data = {};

    static snapshot() {
        return {
            task: this.task,
            taskStep: this.taskStep,
            data: { ...this.data },
        };
    }
    static restore(snap) {
        this.task = snap.task;
        this.taskStep = snap.taskStep;
        this.data = { ...snap.data };
        Actions.syncTaskUI();
    }
    static setTask(name, data) {
        this.task = name;
        this.taskStep = 0;
        this.data = data;
        Actions.syncTaskUI();
    }
    static reset() {
        this.task = "";
        this.taskStep = 0;
        this.data = {};
        Actions.syncTaskUI();
    }
    static nextStep() {
        this.taskStep += 1;
        Actions.syncTaskUI();
    }
}