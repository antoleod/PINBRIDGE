/**
 * PINBRIDGE Event Bus (Core)
 * Simple Pub/Sub for loosely coupled modules.
 */

class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * Subscribe to an event
     * @param {string} eventName 
     * @param {function} callback 
     * @returns {function} unsubscribe function
     */
    on(eventName, callback) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);

        return () => this.off(eventName, callback);
    }

    /**
     * Unsubscribe
     * @param {string} eventName 
     * @param {function} callback 
     */
    off(eventName, callback) {
        if (!this.listeners[eventName]) return;
        this.listeners[eventName] = this.listeners[eventName].filter(cb => cb !== callback);
    }

    /**
     * Emit an event
     * @param {string} eventName 
     * @param {*} data 
     */
    emit(eventName, data) {
        if (!this.listeners[eventName]) return;
        this.listeners[eventName].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in listener for event "${eventName}":`, error);
            }
        });
    }
}

export const bus = new EventBus();
