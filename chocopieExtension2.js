/*
 *This program is free software: you can redistribute it and/or modify
 *it under the terms of the GNU General Public License as published by
 *the Free Software Foundation, either version 3 of the License, or
 *(at your option) any later version.
 *
 *This program is distributed in the hope that it will be useful,
 *but WITHOUT ANY WARRANTY; without even the implied warranty of
 *MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *GNU General Public License for more details.
 *
 *You should have received a copy of the GNU General Public License
 *along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *It was writed by TaeHui Lee and GangMun Lee through KOREA SCIENCE.
 */

(function(ext) {

  var PIN_MODE = 0xF4,
    REPORT_DIGITAL = 0xD0,
    REPORT_ANALOG = 0xC0,
    DIGITAL_MESSAGE = 0x90,
    START_SYSEX = 0xF0,
    END_SYSEX = 0xF7,
    QUERY_FIRMWARE = 0x79,
    REPORT_VERSION = 0xF9,
    ANALOG_MESSAGE = 0xE0,
    ANALOG_MAPPING_QUERY = 0x69,
    ANALOG_MAPPING_RESPONSE = 0x6A,
    CAPABILITY_QUERY = 0x6B,
    CAPABILITY_RESPONSE = 0x6C;

  var INPUT = 0x00,
    OUTPUT = 0x01,
    ANALOG = 0x02,
    PWM = 0x03,
    SERVO = 0x04,
    SHIFT = 0x05,
    I2C = 0x06,
    ONEWIRE = 0x07,
    STEPPER = 0x08,
    ENCODER = 0x09,
    SERIAL = 0x0A,
    PULLUP = 0x0B,
    IGNORE = 0x7F,
    TOTAL_PIN_MODES = 13;

  var LOW = 0,
    HIGH = 1;

  var MAX_DATA_BYTES = 4096;
  var MAX_PINS = 128;

  var parsingSysex = false,
    waitForData = 0,
    executeMultiByteCommand = 0,
    multiByteChannel = 0,
    sysexBytesRead = 0,
    storedInputData = new Uint8Array(MAX_DATA_BYTES);

  var digitalOutputData = new Uint8Array(16),
    digitalInputData = new Uint8Array(16),
    analogInputData = new Uint16Array(16);

  var analogChannel = new Uint8Array(MAX_PINS);
  var pinModes = [];
  for (var i = 0; i < TOTAL_PIN_MODES; i++) pinModes[i] = [];

  var majorVersion = 0,
    minorVersion = 0;

  var connected = false;
  var notifyConnection = false;
  var device = null;
  var inputData = null;

  // TEMPORARY WORKAROUND
  // Since _deviceRemoved is not used with Serial devices
  // ping device regularly to check connection
  var pinging = false;
  var pingCount = 0;
  var pinger = null;

  var hwList = new HWList();

  function HWList() {
    this.devices = [];

    this.add = function(dev, pin) {
      var device = this.search(dev);
      if (!device) {
        device = {name: dev, pin: pin, val: 0};
        this.devices.push(device);
      } else {
        device.pin = pin;
        device.val = 0;
      }
    };

    this.search = function(dev) {
      for (var i=0; i<this.devices.length; i++) {
        if (this.devices[i].name === dev)
          return this.devices[i];
      }
      return null;
    };
  }

  function init() {

    for (var i = 0; i < 16; i++) {
      var output = new Uint8Array([REPORT_DIGITAL | i, 0x01]);
      device.send(output.buffer);
    }

    queryCapabilities();

    // TEMPORARY WORKAROUND
    // Since _deviceRemoved is not used with Serial devices
    // ping device regularly to check connection
    pinger = setInterval(function() {
      if (pinging) {
        if (++pingCount > 6) {
          clearInterval(pinger);
          pinger = null;
          connected = false;
          if (device) device.close();
          device = null;
          return;
        }
      } else {
        if (!device) {
          clearInterval(pinger);
          pinger = null;
          return;
        }
        queryFirmware();
        pinging = true;
      }
    }, 100);
  }

  function hasCapability(pin, mode) {
    if (pinModes[mode].indexOf(pin) > -1)
      return true;
    else
      return false;
  }

  function queryFirmware() {
    var output = new Uint8Array([START_SYSEX, QUERY_FIRMWARE, END_SYSEX]);
    device.send(output.buffer);
  }

  function queryCapabilities() {
    console.log('Querying ' + device.id + ' capabilities');
    var msg = new Uint8Array([
        START_SYSEX, CAPABILITY_QUERY, END_SYSEX]);
    device.send(msg.buffer);
  }

  function queryAnalogMapping() {
    console.log('Querying ' + device.id + ' analog mapping');
    var msg = new Uint8Array([
        START_SYSEX, ANALOG_MAPPING_QUERY, END_SYSEX]);
    device.send(msg.buffer);
  }

  function setDigitalInputs(portNum, portData) {
    digitalInputData[portNum] = portData;
  }

  function setAnalogInput(pin, val) {
    analogInputData[pin] = val;
  }

  function setVersion(major, minor) {
    majorVersion = major;
    minorVersion = minor;
  }

  function processSysexMessage() {
    switch(storedInputData[0]) {
      case CAPABILITY_RESPONSE:
        for (var i = 1, pin = 0; pin < MAX_PINS; pin++) {
          while (storedInputData[i++] != 0x7F) {
            pinModes[storedInputData[i-1]].push(pin);
            i++; //Skip mode resolution
          }
          if (i == sysexBytesRead) break;
        }
        queryAnalogMapping();
        break;
      case ANALOG_MAPPING_RESPONSE:
        for (var pin = 0; pin < analogChannel.length; pin++)
          analogChannel[pin] = 127;
        for (var i = 1; i < sysexBytesRead; i++)
          analogChannel[i-1] = storedInputData[i];
        for (var pin = 0; pin < analogChannel.length; pin++) {
          if (analogChannel[pin] != 127) {
            var out = new Uint8Array([
                REPORT_ANALOG | analogChannel[pin], 0x01]);
            device.send(out.buffer);
          }
        }
        notifyConnection = true;
        setTimeout(function() {
          notifyConnection = false;
        }, 100);
        break;
      case QUERY_FIRMWARE:
        if (!connected) {
          clearInterval(poller);
          poller = null;
          clearTimeout(watchdog);
          watchdog = null;
          connected = true;
          setTimeout(init, 200);
        }
        pinging = false;
        pingCount = 0;
        break;
    }
  }

  function processInput(inputData) {
    for (var i=0; i < inputData.length; i++) {
      if (parsingSysex) {
        if (inputData[i] == END_SYSEX) {
          parsingSysex = false;
          processSysexMessage();
        } else {
          storedInputData[sysexBytesRead++] = inputData[i];
        }
      } else if (waitForData > 0 && inputData[i] < 0x80) {
        storedInputData[--waitForData] = inputData[i];
        if (executeMultiByteCommand !== 0 && waitForData === 0) {
          switch(executeMultiByteCommand) {
            case DIGITAL_MESSAGE:
              setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
              break;
            case ANALOG_MESSAGE:
              setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
              break;
            case REPORT_VERSION:
              setVersion(storedInputData[1], storedInputData[0]);
              break;
          }
        }
      } else {
        if (inputData[i] < 0xF0) {
          command = inputData[i] & 0xF0;
          multiByteChannel = inputData[i] & 0x0F;
        } else {
          command = inputData[i];
        }
        switch(command) {
          case DIGITAL_MESSAGE:
          case ANALOG_MESSAGE:
          case REPORT_VERSION:
            waitForData = 2;
            executeMultiByteCommand = command;
            break;
          case START_SYSEX:
            parsingSysex = true;
            sysexBytesRead = 0;
            break;
        }
      }
    }
  }

  function pinMode(pin, mode) {
    var msg = new Uint8Array([PIN_MODE, pin, mode]);
    device.send(msg.buffer);
  }

  function analogRead(pin) {
    if (pin >= 0 && pin < pinModes[ANALOG].length) {
      return Math.round((analogInputData[pin] * 100) / 1023);
    } else {
      var valid = [];
      for (var i = 0; i < pinModes[ANALOG].length; i++)
        valid.push(i);
      console.log('ERROR: valid analog pins are ' + valid.join(', '));
      return;
    }
  }

  function digitalRead(pin) {
    if (!hasCapability(pin, INPUT)) {
      console.log('ERROR: valid input pins are ' + pinModes[INPUT].join(', '));
      return;
    }
    pinMode(pin, INPUT);
    return (digitalInputData[pin >> 3] >> (pin & 0x07)) & 0x01;
  }

  function analogWrite(pin, val) {
    if (!hasCapability(pin, PWM)) {
      console.log('ERROR: valid PWM pins are ' + pinModes[PWM].join(', '));
      return;
    }
    if (val < 0) val = 0;
    else if (val > 100) val = 100;
    val = Math.round((val / 100) * 255);
    pinMode(pin, PWM);
    var msg = new Uint8Array([
        ANALOG_MESSAGE | (pin & 0x0F),
        val & 0x7F,
        val >> 7]);
    device.send(msg.buffer);
  }

  function digitalWrite(pin, val) {
    if (!hasCapability(pin, OUTPUT)) {
      console.log('ERROR: valid output pins are ' + pinModes[OUTPUT].join(', '));
      return;
    }
    var portNum = (pin >> 3) & 0x0F;
    if (val == LOW)
      digitalOutputData[portNum] &= ~(1 << (pin & 0x07));
    else
      digitalOutputData[portNum] |= (1 << (pin & 0x07));
    pinMode(pin, OUTPUT);
    var msg = new Uint8Array([
        DIGITAL_MESSAGE | portNum,
        digitalOutputData[portNum] & 0x7F,
        digitalOutputData[portNum] >> 0x07]);
    device.send(msg.buffer);
  }

  function rotateServo(pin, deg) {
    if (!hasCapability(pin, SERVO)) {
      console.log('ERROR: valid servo pins are ' + pinModes[SERVO].join(', '));
      return;
    }
    pinMode(pin, SERVO);
    var msg = new Uint8Array([
        ANALOG_MESSAGE | (pin & 0x0F),
        deg & 0x7F,
        deg >> 0x07]);
    device.send(msg.buffer);
  }

  ext.whenConnected = function() {
    if (notifyConnection) return true;
    return false;
  };

  ext.analogWrite = function(pin, val) {
    analogWrite(pin, val);
  };

  ext.digitalWrite = function(pin, val) {
    if (val == menus[lang]['outputs'][0])
      digitalWrite(pin, HIGH);
    else if (val == menus[lang]['outputs'][1])
      digitalWrite(pin, LOW);
  };

  ext.analogRead = function(pin) {
    return analogRead(pin);
  };

  ext.digitalRead = function(pin) {
    return digitalRead(pin);
  };

  ext.whenAnalogRead = function(pin, op, val) {
    if (pin >= 0 && pin < pinModes[ANALOG].length) {
      if (op == '>')
        return analogRead(pin) > val;
      else if (op == '<')
        return analogRead(pin) < val;
      else if (op == '=')
        return analogRead(pin) == val;
      else
        return false;
    }
  };

  ext.whenDigitalRead = function(pin, val) {
    if (hasCapability(pin, INPUT)) {
      if (val == menus[lang]['outputs'][0])
        return digitalRead(pin);
      else if (val == menus[lang]['outputs'][1])
        return digitalRead(pin) === false;
    }
  };

  ext.connectHW = function(hw, pin) {
    hwList.add(hw, pin);
  };

  ext.rotateServo = function(servo, deg) {
    var hw = hwList.search(servo);
    if (!hw) return;
    if (deg < 0) deg = 0;
    else if (deg > 180) deg = 180;
    rotateServo(hw.pin, deg);
    hw.val = deg;
  };

  ext.changeServo = function(servo, change) {
    var hw = hwList.search(servo);
    if (!hw) return;
    var deg = hw.val + change;
    if (deg < 0) deg = 0;
    else if (deg > 180) deg = 180;
    rotateServo(hw.pin, deg);
    hw.val = deg;
  };

  ext.setLED = function(led, val) {
    var hw = hwList.search(led);
    if (!hw) return;
    analogWrite(hw.pin, val);
    hw.val = val;
  };

  ext.changeLED = function(led, val) {
    var hw = hwList.search(led);
    if (!hw) return;
    var b = hw.val + val;
    if (b < 0) b = 0;
    else if (b > 100) b = 100;
    analogWrite(hw.pin, b);
    hw.val = b;
  };

  ext.digitalLED = function(led, val) {
    var hw = hwList.search(led);
    if (!hw) return;
    if (val == 'on') {
      digitalWrite(hw.pin, HIGH);
      hw.val = 255;
    } else if (val == 'off') {
      digitalWrite(hw.pin, LOW);
      hw.val = 0;
    }
  };

  ext.readInput = function(name) {
    var hw = hwList.search(name);
    if (!hw) return;
    return analogRead(hw.pin);
  };

  ext.whenButton = function(btn, state) {
    var hw = hwList.search(btn);
    if (!hw) return;
    if (state === 'pressed')
      return digitalRead(hw.pin);
    else if (state === 'released')
      return !digitalRead(hw.pin);
  };

  ext.isButtonPressed = function(btn) {
    var hw = hwList.search(btn);
    if (!hw) return;
    return digitalRead(hw.pin);
  };

  ext.whenInput = function(name, op, val) {
    var hw = hwList.search(name);
    if (!hw) return;
    if (op == '>')
      return analogRead(hw.pin) > val;
    else if (op == '<')
      return analogRead(hw.pin) < val;
    else if (op == '=')
      return analogRead(hw.pin) == val;
    else
      return false;
  };

  ext.mapValues = function(val, aMin, aMax, bMin, bMax) {
    var output = (((bMax - bMin) * (val - aMin)) / (aMax - aMin)) + bMin;
    return Math.round(output);
  };

  ext._getStatus = function() {
    if (!connected)
      return { status:1, msg:'Disconnected' };
    else
      return { status:2, msg:'Connected' };
  };

  ext._deviceRemoved = function(dev) {
    console.log('Device removed');
    // Not currently implemented with serial devices
  };

  var potentialDevices = [];
  ext._deviceConnected = function(dev) {
    potentialDevices.push(dev);
    if (!device)
      tryNextDevice();
  };

  var poller = null;
  var watchdog = null;
  function tryNextDevice() {
    device = potentialDevices.shift();
    if (!device) return;

    device.open({ stopBits: 0, bitRate: 57600, ctsFlowControl: 0 });
    console.log('Attempting connection with ' + device.id);
    device.set_receive_handler(function(data) {
      var inputData = new Uint8Array(data);
      processInput(inputData);
    });

    poller = setInterval(function() {
      queryFirmware();
    }, 1000);

    watchdog = setTimeout(function() {
      clearInterval(poller);
      poller = null;
      device.set_receive_handler(null);
      device.close();
      device = null;
      tryNextDevice();
    }, 5000);
  }

  ext._shutdown = function() {
    // TODO: Bring all pins down
    if (device) device.close();
    if (poller) clearInterval(poller);
    device = null;
  };

  // Check for GET param 'lang'
  var paramString = window.location.search.replace(/^\?|\/$/g, '');
  var vars = paramString.split("&");
  var lang = 'en';
  for (var i=0; i<vars.length; i++) {
    var pair = vars[i].split('=');
    if (pair.length > 1 && pair[0]=='lang')
      lang = pair[1];
  }

  var blocks = {
    en: [
      ['h', 'when device is connected', 'whenConnected'],
      [' ', 'connect %m.hwOut to pin %n', 'connectHW', 'led A', 3],
      [' ', 'connect %m.hwIn to analog %n', 'connectHW', 'rotation knob', 0],
      ['-'],
      [' ', 'set %m.leds %m.outputs', 'digitalLED', 'led A', 'on'],
      [' ', 'set %m.leds brightness to %n%', 'setLED', 'led A', 100],
      [' ', 'change %m.leds brightness by %n%', 'changeLED', 'led A', 20],
      ['-'],
      [' ', 'rotate %m.servos to %n degrees', 'rotateServo', 'servo A', 180],
      [' ', 'rotate %m.servos by %n degrees', 'changeServo', 'servo A', 20],
      ['-'],
      ['h', 'when %m.buttons is %m.btnStates', 'whenButton', 'button A', 'pressed'],
      ['b', '%m.buttons pressed?', 'isButtonPressed', 'button A'],
      ['-'],
      ['h', 'when %m.hwIn %m.ops %n%', 'whenInput', 'light sensor', '>', 50],
      ['r', 'read %m.hwIn', 'readInput', 'light sensor'],		//Patched
      ['-'],
      [' ', 'set pin %n %m.outputs', 'digitalWrite', 1, 'on'],
      [' ', 'set pin %n to %n%', 'analogWrite', 3, 100],
      ['-'],
      ['h', 'when pin %n is %m.outputs', 'whenDigitalRead', 1, 'on'],
      ['b', 'pin %n on?', 'digitalRead', 1],
      ['-'],
      //['h', 'when analog %m.analogSensor %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
      ['r', 'read analog %m.analogSensor', 'analogRead', 0],
	  //['h', 'when remoted analog %m.RanalogSensor %m.ops %n%', 'whenRAnalogRead', 1, '>', 50],
      ['r', 'read remoted analog %m.RanalogSensor', 'RAnalogRead', 0],		//Patched
      ['-'],
      ['r', 'map %n from %n %n to %n %n', 'mapValues', 50, 0, 100, -240, 240],
	  ['-'],
	  ['r', '%m.touch touch sensor pressed?', 'isButtonPressed', '1'],
	  ['r', '%m.Rtouch remoted touch sensor pressed?', 'isButtonPressed', '1']	//Writed
    ],
    ko: [
      ['h', '초코파이가 연결됐을 때', 'whenConnected'],
      [' ', '%m.hwOut 를 %n 번 핀에 연결하기', 'connectHW', 'led A', 3],
      [' ', '%m.hwIn 를 아날로그 %n 번 핀에 연결하기', 'connectHW', '회전 손잡이', 0],
      ['-'],
      [' ', '%m.leds 를 %m.outputs', 'digitalLED', 'led A', '켜기'],
      [' ', '%m.leds 의 밝기를 %n% 로 설정하기', 'setLED', 'led A', 100],
      [' ', '%m.leds 의 밝기를 %n% 만큼 바꾸기', 'changeLED', 'led A', 20],
      ['-'],
      [' ', '%m.servos 를 %n 도로 회전하기', 'rotateServo', '서보모터 A', 180],
      [' ', '%m.servos 를 %n 도 만큼 회전하기', 'changeServo', '서보모터 A', 20],
      ['-'],
      ['h', '%m.buttons 의 상태가 %m.btnStates 일 때', 'whenButton', '버튼 A', '눌림'],
      ['b', '%m.buttons 가 눌려져 있는가?', 'isButtonPressed', '버튼 A'],
      ['-'],
      ['h', '%m.hwIn 의 값이 %m.ops %n% 일 때', 'whenInput', '조도 센서', '>', 50],	//Patched 
      ['r', '%m.hwIn 의 값', 'readInput', '조도 센서'],
      ['-'],
      [' ', '%n 번 핀을 %m.outputs', 'digitalWrite', 1, '켜기'],
      [' ', '%n 번 핀의 값을 %n% 로 설정하기', 'analogWrite', 3, 100],
      ['-'],
      ['h', '%n 번 핀의 상태가 %m.outputs 일 때', 'whenDigitalRead', 1, '켜기'],
      ['b', '%n 번 핀이 켜져있는가?', 'digitalRead', 1],
      ['-'],
      //['h', '아날로그 %m.analogSensor 번의 값이 %m.ops %n% 일 때', 'whenAnalogRead', 1, '>', 50],
      ['r', '아날로그 %m.analogSensor 번의 값', 'analogRead', 0],
	  //['h', '원격 아날로그 %m.RanalogSensor 번의 값이 %m.ops %n% 일 때', 'whenRAnalogRead', 1, '>', 50],
      ['r', '원격 아날로그 %m.RanalogSensor 번의 값', 'RAnalogRead', 0],	//Patched 
      ['-'],
      ['r', '%n 을(를) %n ~ %n 에서 %n ~ %n 의 범위로 바꾸기', 'mapValues', 50, 0, 100, -240, 240],
	  ['-'],
	  ['r', '%m.touch 터치 센서가 눌렸는가?', 'isButtonPressed', '1'],
	  ['r', '%m.Rtouch 원격 터치 센서가 눌렸는가?', 'isButtonPressed', '1']	// Writed
    ]
  };

  var menus = {
    en: {
		buttons: ['button A', 'button B', 'button C', 'button D'],
		btnStates: ['pressed', 'released'],
		hwIn: ['light sensor', 'temperature sensor', 'humidity sensor'],	// To in Hardware Value
		RhwIn: ['remote light sensor', 'remote temperature sensor', 'remote humidity sensor'],

		hwOut: ['led A', 'led B', 'led C', 'led D', 'button A', 'button B', 'button C', 'button D', 'servo A', 'servo B', 'servo C', 'servo D'], 
		//To out Hardware Value 
		leds: ['led A', 'led B', 'led C', 'led D'],
		outputs: ['on', 'off'],
		ops: ['>', '=', '<'],
		servos: ['servo A', 'servo B', 'servo C', 'servo D'],

		booleanSensor: ['button pressed', 'A connected', 'B connected', 'C connected', 'D connected'],
		analogSensor: ['1', '2', '3', '4'],
		RanalogSensor: ['1', '2', '3', '4'],
		// Remoted Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		touch: ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],
		Rtouch : ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],

		sw: ['1', '2', '3', '4', 'J'],
		joystick: ['X', 'Y'],
		potency: ['1'],
		infrared: ['1','2','3'],
		acceler: ['X','Y','Z'],
		pacceler: ['U','V','W'],
        lessMore: ['>', '<']	

    },
    ko: {
		buttons: ['버튼 A', '버튼 B', '버튼 C', '버튼 D'],
		btnStates: ['눌림', '떼짐'],

		hwIn: ['조도 센서', '온도 센서','습도 센서'],
		RhwIn: ['원격 조도 센서', '원격 온도 센서','원격 습도 센서'], 

		hwOut: ['led A', 'led B', 'led C', 'led D', '버튼 A', '버튼 B', '버튼 C', '버튼 D', '서보모터 A', '서보모터 B', '서보모터 C', '서보모터 D'],
		leds: ['led A', 'led B', 'led C', 'led D'],
		outputs: ['켜기', '끄기'],
		ops: ['>', '=', '<'],
		servos: ['서보모터 A', '서보모터 B', '서보모터 C', '서보모터 D'],

		booleanSensor: ['button pressed', 'A connected', 'B connected', 'C connected', 'D connected'],
        analogSensor: ['1', '2', '3', '4'],
		RanalogSensor: ['1', '2', '3', '4'],
		// Remoted Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added


		touch: ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],
		Rtouch : ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],

		sw: ['1', '2', '3', '4', 'J'],
		joystick: ['X', 'Y'],
		potency: ['1'],
		infrared: ['1','2','3'],
		acceler: ['X','Y','Z'],
		pacceler: ['U','V','W'],
        lessMore: ['>', '<']	
    }
  };

  var descriptor = {
    blocks: blocks[lang],
    menus: menus[lang],
    url: 'http://remoted.github.io/scratch-chocopie-extension'
  };

  ScratchExtensions.register('ChocopieBoard', descriptor, ext, {type:'serial'});

})({});