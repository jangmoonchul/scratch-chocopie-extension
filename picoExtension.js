// picoExtension.js
// Shane M. Clements, February 2014
// PicoBoard Scratch Extension
//
// This is an extension for development and testing of the Scratch Javascript Extension API.

(function(ext) {
    var device = null;
    var rawData = null;

    // Sensor states:
    var channels = {
        slider: 7,
        light: 5,
        sound: 6,
        button: 3,
        'resistance-A': 4,
        'resistance-B': 2,
        'resistance-C': 1,
        'resistance-D': 0
    };
    var inputs = {
        slider: 0,
        light: 0,
        sound: 0,
        button: 0,
        'resistance-A': 0,
        'resistance-B': 0,
        'resistance-C': 0,
        'resistance-D': 0
    };

    ext.resetAll = function(){};

    // Hats / triggers
    ext.whenSensorConnected = function(which) {
        return getSensorPressed(which);
    };

    ext.whenSensorPass = function(which, sign, level) {
        if (sign == '<') return getSensor(which) < level;
        return getSensor(which) > level;
    };

    // Reporters
    ext.sensorPressed = function(which) {
        return getSensorPressed(which);
    };

    ext.sensor = function(which) { return getSensor(which); };

    // Private logic
    function getSensorPressed(which) {
        if (device == null) return false;
        if (which == 'button pressed' && getSensor('button') < 1) return true;
        if (which == 'A connected' && getSensor('resistance-A') < 10) return true;
        if (which == 'B connected' && getSensor('resistance-B') < 10) return true;
        if (which == 'C connected' && getSensor('resistance-C') < 10) return true;
        if (which == 'D connected' && getSensor('resistance-D') < 10) return true;
        return false;
    }

    function getSensor(which) {
        return inputs[which];
    }

    var inputArray = [];
    function processData() {
        var bytes = new Uint8Array(rawData);

        inputArray[15] = 0;

        // TODO: make this robust against misaligned packets.
        // Right now there's no guarantee that our 18 bytes start at the beginning of a message.
        // Maybe we should treat the data as a stream of 2-byte packets instead of 18-byte packets.
        // That way we could just check the high bit of each byte to verify that we're aligned.
        for(var i=0; i<9; ++i) {
            var hb = bytes[i*2] & 127;
            var channel = hb >> 3;
            var lb = bytes[i*2+1] & 127;
            inputArray[channel] = ((hb & 7) << 7) + lb;
        }

        if (watchdog && (inputArray[15] == 0x04)) {
            // Seems to be a valid PicoBoard.
            clearTimeout(watchdog);
            watchdog = null;
        }

        for(var name in inputs) {
            var v = inputArray[channels[name]];
            if(name == 'light') {
                v = (v < 25) ? 100 - v : Math.round((1023 - v) * (75 / 998));
            }
            else if(name == 'sound') {
                //empirically tested noise sensor floor
                v = Math.max(0, v - 18)
                v =  (v < 50) ? v / 2 :
                    //noise ceiling
                    25 + Math.min(75, Math.round((v - 50) * (75 / 580)));
            }
            else {
                v = (100 * v) / 1023;
            }

            inputs[name] = v;
        }

        //console.log(inputs);
        rawData = null;
    }

    function appendBuffer( buffer1, buffer2 ) {
        var tmp = new Uint8Array( buffer1.byteLength + buffer2.byteLength );
        tmp.set( new Uint8Array( buffer1 ), 0 );
        tmp.set( new Uint8Array( buffer2 ), buffer1.byteLength );
        return tmp.buffer;
    }

    // Extension API interactions
    var potentialDevices = [];
    ext._deviceConnected = function(dev) {
        potentialDevices.push(dev);

        if (!device) {
            tryNextDevice();
        }
    }

    function tryNextDevice() {
        // If potentialDevices is empty, device will be undefined.
        // That will get us back here next time a device is connected.
        device = potentialDevices.shift();

        if (device) {
            device.open({ stopBits: 0, bitRate: 38400, ctsFlowControl: 0 }, deviceOpened);
        }
    }

    var poller = null;
    var watchdog = null;
    function deviceOpened(dev) {
        if (!dev) {
            // Opening the port failed.
            tryNextDevice();
            return;
        }
        device.set_receive_handler(function(data) {
            //console.log('Received: ' + data.byteLength);
            if(!rawData || rawData.byteLength == 18) rawData = new Uint8Array(data);
            else rawData = appendBuffer(rawData, data);

            if(rawData.byteLength >= 18) {
                //console.log(rawData);
                processData();
                //device.send(pingCmd.buffer);
            }
        });

        // Tell the PicoBoard to send a input data every 50ms
        var pingCmd = new Uint8Array(1);
        pingCmd[0] = 1;
        poller = setInterval(function() {
            device.send(pingCmd.buffer);
        }, 50);
        watchdog = setTimeout(function() {
            // This device didn't get good data in time, so give up on it. Clean up and then move on.
            // If we get good data then we'll terminate this watchdog.
            clearInterval(poller);
            poller = null;
            device.set_receive_handler(null);
            device.close();
            device = null;
            tryNextDevice();
        }, 250);
    };

    ext._deviceRemoved = function(dev) {
        if(device != dev) return;
        if(poller) poller = clearInterval(poller);
        device = null;
    };

    ext._shutdown = function() {
        if(device) device.close();
        if(poller) poller = clearInterval(poller);
        device = null;
    };

    ext._getStatus = function() {
        if(!device) return {status: 1, msg: 'PicoBoard disconnected'};
        if(watchdog) return {status: 1, msg: 'Probing for PicoBoard'};
        return {status: 2, msg: 'PicoBoard connected'};
   }

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
		['-'],
		[' ', '%m.networks %m.servosport %m.servos to %n degrees', 'rotateServo', 'normal', 'Port 1', 'Servo 1', 180],
		['-'],
		['r', 'read from %m.networks to %m.hwIn', 'readSENSOR', 'normal','temperature sensor'],		//light, temperature, humidity and analog sensor combined (normal, remote)
		['-'],																				//function_name: readSENSOR
		['b', '%m.networks touch sensor %m.touch is pressed?', 'isTouchButtonPressed', 'normal', '1'],		//Touch Sensor is boolean block (normal, remote)
																								//function_name : isTouchButtonPressed
		['-'],
		['h', 'when %m.networks sw block %m.sw to %m.btnStates', 'whenButton', 'normal', 'Button 1', '0'],		//sw block (button 1, .. )
		['b', '%m.networks sw block %m.buttons of value', 'isButtonPressed', 'normal','Button 1'],				//buttons ( button 1,.. , Joystick X, ..)
																												//Buttons, Joystick and Potencyometer function is combined.
		['-'],																									//function_name : whenButton	isButtonPressed
		['r', '%m.networks motion-block %m.motionb of value', 'motionbRead', 'normal','infrared 1'],								//Motion block is infrared, acceler and so on
		['h', 'when %m.networks motion-block %m.photoGate is %m.gateState', 'photoGateRead', 'normal', 'photoGate 1', 'blocked'],	//function_name : motionbRead	photoGateRead	
		['-'],
		[' ', '%m.networks LED LOCATION %n RED %n GREEN %n BLUE %n', 'passLEDrgb', 'normal', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
		[' ', '%m.networks BUZZER PITCH %n DURATION %n seconds', 'passBUZEER', 'normal', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
		['-'],
		[' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection', 'passSteppingAD', 'normal', '1', 0, 'clockwise'],
		[' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection Angle %n', 'passSteppingADA', 'normal', '1', 0, 'clockwise', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
		['-'],
		[' ', '%m.networks %m.dcMotor DC Motor Accel %n Direction %m.stepDirection', 'passDCAD', 'normal', '1', 0, 'clockwise']
		],
		ko: [
		['h', '초코파이가 연결됐을 때', 'whenConnected'],
		//[' ', '%m.leds 를 %m.outputs', 'digitalLED', 'led A', '켜기'],
		['-'],
		[' ', '%m.networks %m.servosport %m.servos 각도 %n', 'rotateServo', '일반', '포트 1', '서보모터 1', 180],	//ServoMotor, Multiple Servo and Remote Servo is defined.
		['-'],																						
		['r', '%m.networks 센서블록 %m.hwIn 의 값', 'readSENSOR', '일반', '온도'],			// 조도, 온도, 습도, 아날로그 통합함수 (일반, 무선)
		['-'],																			// function_name = readSENSOR
		//[' ', '%n 번 핀을 %m.outputs', 'digitalWrite', 1, '켜기'],
		//['-'],
		//['h', '%n 번 핀의 상태가 %m.outputs 일 때', 'whenDigitalRead', 1, '켜기'],
		//['b', '%n 번 핀이 켜져있는가?', 'digitalRead', 1],
		//['-'],
		['b', '%m.networks 터치센서 %m.touch 의 값', 'isTouchButtonPressed', '일반','1'],			//Touch Sensor is boolean block	-- normal and remote					
		['-'],																					//function_name : isTouchButtonPressed 
		['h', '%m.networks 스위치블록 %m.sw 이 %m.btnStates 될 때', 'whenButton', '일반', '버튼 1', '0'],				//sw block (button 1, .. )
		['b', '%m.networks 스위치블록 %m.buttons 의 값', 'isButtonPressed', '일반','버튼 1'],							//buttons ( button 1,.. , Joystick X, ..)				
																													//Buttons, Joystick and Potencyometer function is combined.
		['-'],																										//function_name :  isButtonPressed	whenButton
		['r', '%m.networks 모션블록 %m.motionb 의 값', 'motionbRead', '일반','적외선 감지 1'],								//Motion block is infrared, acceler and so on
		['h', '%m.networks 모션블록 %m.photoGate 가 %m.gateState', 'photoGateRead', '일반', '포토게이트 1', '막힐때'],	//function_name : motionbRead	photoGateRead	
		['-'],																	//LED RGB definition
		[' ', '%m.networks LED블록 위치 %n 빨강 %n 녹색 %n 파랑 %n', 'passLEDrgb', '일반', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
		[' ', '%m.networks 버저 음높이 %n 연주시간 %n 밀리초', 'passBUZEER', '일반', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
		['-'],
		[' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection', 'passSteppingAD', '일반', '1', 0, '시계'],
		[' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection 회전량 %n', 'passSteppingADA', '일반', '1', 0, '시계', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
		['-'],																											//DC motor is defined
		[' ', '%m.networks %m.dcMotor 번 DC모터 속도 %n 방향 %m.stepDirection', 'passDCAD', '일반', '1', 0, '시계']		//function_name : passDCDA passRDCDA	
		]
  };
	 var menus = {
		en: {
		networks: ['normal', 'remote'],
		buttons: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button J', 'Joystick X', 'Joystick Y', 'Potencyometer'],
		sw: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button J'],
		//Buttons, Joystick sensor and potencyomer sensor listing
		
		btnStates: ['0', '1'],
		//0 : pressed  1: released

		hwIn: [ 'temperature sensor', 'humidity sensor', 'light sensor', 'Analog 1', 'Analog 2', 'Analog 3', 'Analog 4'],						
		//Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		outputs: ['on', 'off'],
		ops: ['>', '=', '<'],
		servos: ['Servo 1', 'Servo 2', 'Servo 3', 'Servo 4'],
		//mutiservos: [ '1', '2', '3', '4', '5', '6', '7', '8'],
		servosport: [ 'Port 1', 'Port 2', 'Port 3', 'Port 4', 'Port 5', 'Port 6', 'Port 7', 'Port 8'],

		touch: ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],
		// Touch sensor and Remoted touch sensor listing
		
		motionb: ['infrared 1', 'infrared 2', 'infrared 3', 
				'acceler X', 'acceler Y', 'acceler Z', 
				'pacceler U', 'pacceler V', 'pacceler W', 
				'photoGate 1', 'photoGate 2'],
		photoGate: ['photoGate 1', 'photoGate 2'],
		gateState: ['blocked','opened'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: ['1', '2'],
		stepDirection:['clockwise','declockwise'],
		//steppingMotor is defined.

		dcMotor: ['1','2','3','4']
		//dcMotor is defined.

		},
		ko: {
		networks: ['일반', '무선'],
		buttons: ['버튼 1', '버튼 2', '버튼 3', '버튼 4', '버튼 J', '조이스틱 X', '조이스틱 Y', '포텐시오미터'],
		sw : ['버튼 1', '버튼 2', '버튼 3', '버튼 4', '버튼 J'],
		//Joystick sensor and potencyomer sensor listing
		
		btnStates: ['0', '1'],
		// 0 : 눌림  1 : 떼짐
		
		hwIn: ['온도', '습도','조도','아날로그 1', '아날로그 2', '아날로그 3', '아날로그 4'],
		// light, temperature and humidity and Analog Sensor for 1, 2, 3 and 4 is defined.

		outputs: ['켜기', '끄기'],
		ops: ['>', '=', '<'],
		servos: ['서보모터 1', '서보모터 2', '서보모터 3', '서보모터 4'],
		servosport: [ '포트 1', '포트 2', '포트 3', '포트 4', '포트 5', '포트 6', '포트 7', '포트 8'],
		
		touch: ['1', '2', '3', '4', '5', '6', '7','8','9','10','11','12'],
		// Touch sensor listing

		motionb: ['적외선 감지 1', '적외선 감지  2', '적외선 감지  3', 
				'가속도 X', '가속도 Y', '가속도 Z', 
				'각가속도 U', '각가속도 V', '각가속도 W', 
				'포토게이트 1', '포토게이트 2'],
		photoGate: ['포토게이트 1', '포토게이트 2'],
		gateState: ['막힐때','열릴때'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: ['1', '2'],
		stepDirection:['시계','반시계'],
		//steppingMotor is defined.

		dcMotor: ['1','2','3','4']
		//dcMotor is defined.
		}
	};

	var descriptor = {
		blocks: blocks[lang],
		menus: menus[lang],
		url: 'http://remoted.github.io/scratch-chocopie-extension'
	};
	ScratchExtensions.register('ChocopieBoard', descriptor, ext, {type:'serial'});
})({});
