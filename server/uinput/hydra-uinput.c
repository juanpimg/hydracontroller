/*
 * hydra-uinput.c
 * Hydra Controller - High Performance Virtual Multitouch & Keyboard Bridge
 * Emulates pure Linux kernel EV_ABS Multitouch Screen & EV_KEY devices via /dev/uinput.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <linux/uinput.h>

#define MAX_SLOTS 10
#define DEFAULT_WIDTH 1920
#define DEFAULT_HEIGHT 1080

static int uinput_fd = -1;

void cleanup_device() {
    if (uinput_fd >= 0) {
        ioctl(uinput_fd, UI_DEV_DESTROY);
        close(uinput_fd);
        uinput_fd = -1;
    }
}

void sig_handler(int sig) {
    (void)sig;
    cleanup_device();
    exit(0);
}

static void emit(int fd, int type, int code, int val) {
    struct input_event ie;
    memset(&ie, 0, sizeof(ie));
    ie.type = type;
    ie.code = code;
    ie.value = val;
    write(fd, &ie, sizeof(ie));
}

int init_uinput(int max_x, int max_y) {
    uinput_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (uinput_fd < 0) {
        perror("FATAL: Failed to open /dev/uinput");
        return -1;
    }

    // Enable Events
    ioctl(uinput_fd, UI_SET_EVBIT, EV_SYN);
    ioctl(uinput_fd, UI_SET_EVBIT, EV_KEY);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_TOUCH);

    // Enable standard keyboard keys
    for (int k = 1; k < 255; k++) {
        ioctl(uinput_fd, UI_SET_KEYBIT, k);
    }

    ioctl(uinput_fd, UI_SET_EVBIT, EV_ABS);
    ioctl(uinput_fd, UI_SET_ABSBIT, ABS_MT_SLOT);
    ioctl(uinput_fd, UI_SET_ABSBIT, ABS_MT_TRACKING_ID);
    ioctl(uinput_fd, UI_SET_ABSBIT, ABS_MT_POSITION_X);
    ioctl(uinput_fd, UI_SET_ABSBIT, ABS_MT_POSITION_Y);
    ioctl(uinput_fd, UI_SET_ABSBIT, ABS_MT_PRESSURE);

    struct uinput_user_dev uidev;
    memset(&uidev, 0, sizeof(uidev));
    snprintf(uidev.name, UINPUT_MAX_NAME_SIZE, "Hydra Mobile Touchscreen");
    uidev.id.bustype = BUS_VIRTUAL;
    uidev.id.vendor  = 0x1337;
    uidev.id.product = 0x4242;
    uidev.id.version = 1;

    uidev.absmin[ABS_MT_SLOT] = 0;
    uidev.absmax[ABS_MT_SLOT] = MAX_SLOTS - 1;

    uidev.absmin[ABS_MT_TRACKING_ID] = 0;
    uidev.absmax[ABS_MT_TRACKING_ID] = 65535;

    uidev.absmin[ABS_MT_POSITION_X] = 0;
    uidev.absmax[ABS_MT_POSITION_X] = max_x > 0 ? max_x : DEFAULT_WIDTH;

    uidev.absmin[ABS_MT_POSITION_Y] = 0;
    uidev.absmax[ABS_MT_POSITION_Y] = max_y > 0 ? max_y : DEFAULT_HEIGHT;

    uidev.absmin[ABS_MT_PRESSURE] = 0;
    uidev.absmax[ABS_MT_PRESSURE] = 255;

    if (write(uinput_fd, &uidev, sizeof(uidev)) < 0) {
        perror("FATAL: Failed to write uinput_user_dev configuration");
        close(uinput_fd);
        uinput_fd = -1;
        return -1;
    }

    if (ioctl(uinput_fd, UI_DEV_CREATE) < 0) {
        perror("FATAL: ioctl UI_DEV_CREATE failed");
        close(uinput_fd);
        uinput_fd = -1;
        return -1;
    }

    fprintf(stderr, "[hydra-uinput] Initialized virtual touchscreen (0..%d, 0..%d)\n",
            uidev.absmax[ABS_MT_POSITION_X], uidev.absmax[ABS_MT_POSITION_Y]);
    return 0;
}

int main(int argc, char** argv) {
    int max_x = DEFAULT_WIDTH;
    int max_y = DEFAULT_HEIGHT;
    if (argc >= 3) {
        max_x = atoi(argv[1]);
        max_y = atoi(argv[2]);
    }

    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    if (init_uinput(max_x, max_y) < 0) {
        return 1;
    }

    // Packet Protocol:
    // Packet type 1: Touch Event [0x01, slot(uint8), tracking_id(int16), x(uint16), y(uint16), pressure(uint8)] -> 9 bytes
    // Packet type 2: Frame Sync  [0x02, active_touch_count(uint8)] -> 2 bytes
    // Packet type 3: Key Event   [0x03, keycode(uint16), state(uint8)] -> 4 bytes
    
    while (1) {
        uint8_t type;
        ssize_t n = read(STDIN_FILENO, &type, 1);
        if (n <= 0) break;

        if (type == 0x01) {
            // Touch Event: 8 bytes payload
            uint8_t payload[8];
            if (read(STDIN_FILENO, payload, 8) != 8) continue;
            uint8_t slot = payload[0];
            int16_t tracking_id = (int16_t)(payload[1] | (payload[2] << 8));
            uint16_t x = (uint16_t)(payload[3] | (payload[4] << 8));
            uint16_t y = (uint16_t)(payload[5] | (payload[6] << 8));
            uint8_t pressure = payload[7];

            emit(uinput_fd, EV_ABS, ABS_MT_SLOT, slot);
            emit(uinput_fd, EV_ABS, ABS_MT_TRACKING_ID, tracking_id);
            if (tracking_id >= 0) {
                emit(uinput_fd, EV_ABS, ABS_MT_POSITION_X, x);
                emit(uinput_fd, EV_ABS, ABS_MT_POSITION_Y, y);
                emit(uinput_fd, EV_ABS, ABS_MT_PRESSURE, pressure);
            }
        } else if (type == 0x02) {
            // Frame Sync
            uint8_t count = 0;
            read(STDIN_FILENO, &count, 1);
            emit(uinput_fd, EV_KEY, BTN_TOUCH, count > 0 ? 1 : 0);
            emit(uinput_fd, EV_SYN, SYN_REPORT, 0);
        } else if (type == 0x03) {
            // Key Event
            uint8_t payload[3];
            if (read(STDIN_FILENO, payload, 3) != 3) continue;
            uint16_t keycode = (uint16_t)(payload[0] | (payload[1] << 8));
            uint8_t state = payload[2];
            emit(uinput_fd, EV_KEY, keycode, state);
            emit(uinput_fd, EV_SYN, SYN_REPORT, 0);
        }
    }

    cleanup_device();
    return 0;
}
