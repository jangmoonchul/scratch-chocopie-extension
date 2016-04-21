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

	var SCBD_CHOCOPI = 0x10,
		SCBD_CHOCOPI_USB = 0xE0,	//Chocopie USB 연결에 대한 값 디테일(상위값 14, 포트0) 을 지정
		SCBD_CHOCOPI_BLE = 0xF0,	//Chocopie BLE 연결에 대한 값 디테일(상위값 15, 포트0) 를 지정	
		SCBD_SENSOR = 0x80,
		SCBD_TOUCH = 0x90,
		SCBD_SWITCH = 0xA0,
		SCBD_MOTION = 0xB0,
		SCBD_LED = 0xC0,
		SCBD_STEPPER = 0xD0, 
		SCBD_DC_MOTOR = 0xE0,		//SCBD_CHOCOPI_USB 와 구분하기 위해서 반드시 포트에 대해서 OR 연산이 필요함
		SCBD_SERVO = 0xF0;			//SCBD_CHOCOPI_BLE 와 구분하기 위해서 반드시 포트에 대해서 OR 연산이 필요함
		//SCBD_ULTRASONIC = 0x10,		
		//SCBD_PIR = 0x11;
	/*Chocopie const definition
	 * SCBD_ULTRASONIC 와 SCBD_PIR 은 아직 존재하지않는 확장영역으로써 설계되어져있음
	*/

	var CPC_VERSION = 0x08,		//REPORT_VERSION = 0xF9 -> CPC_VERSION 으로 PATCH -- Changed By Remoted 2016.04.14
		CPC_START = 0x09,
		CPC_STOP = 0x0A,
		CPC_SET_NAME = 0x0B,
		CPC_GET_NAME = 0x0C,
		CPC_GET_BLOCK = 0x0D,
		CPC_ALL_SAY = 0x0E;
	//Chocopie command definition
	
  var PIN_MODE = 0xF4,
    REPORT_DIGITAL = 0xD0,		//DIGITAL 신호가 들어왔을때 보고하는 값
    REPORT_ANALOG = 0xC0,		//아날로그 신호가 들어왔을때 보고하는 값
    DIGITAL_MESSAGE = 0x90,
    START_SYSEX = 0x7E,			//메세지의 시작패킷을 알리는 헤더		이스케이핑 필수
    END_SYSEX = 0x7E,			//메세지의 꼬리패킷을 알리는 테일러		이스케이핑 필수
    //QUERY_FIRMWARE = 0xE0,		//0x79 (아두이노) -> 0xE0 (초코파이보드용) QUERY_FIRMWARE 와 SCBD_CHOCOPI_USB 는 같은 값을 유지 (일반)--Changed By Remoted 2016.04.14
    ANALOG_MESSAGE = 0xE0,
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
    TOTAL_PIN_MODES = 11;		//총 가능한 PIN MODE 13 (아두이노) -> 11 (초코파이) 용으로 변경

  var SAMPLING_RATE = 0x0080;

  var LOW = 0x00FF,
    HIGH = 0xFF00;
	//LOW, HIGH 를 연산하기 위해서 패치함 -- 2016.04.20 
  var MAX_DATA_BYTES = 4096;
  var MAX_PINS = 128;

  var parsingSysex = false,
    waitForData = 0,
    executeMultiByteCommand = 0,
    multiByteChannel = 0,
    sysexBytesRead = 0,
	port = 0,
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
	/* search 에서 device 가 존재하지 않는다면,  name, pin, val 을 배열로 묶어서 한번에 잘 추가시킴 
		 -> CPC_GET_BLOCK 을 처리하는 과정에서 0이 아닌경우에만 추가하므로 문제가 되지않음
		device 가 존재한다면, pin, val 만 추가시킴 -> name 의 값은 null 로 배정될 듯
	*/

    this.search = function(dev) {
      for (var i=0; i<this.devices.length; i++) {
        if (this.devices[i].name === dev)
          return this.devices[i];			
      }
      return null;
    };

	
    this.search_bypin = function(pin) {
      for (var i=0; i<this.devices.length; i++) {
        if (this.devices[i].pin === pin)
          return this.devices[i];			
      }
      return null;
    };
	//Writed By Remoted 2016.04.20
	
	this.remove = function(pin) {					//pin 을 받아서, pin 을 가지고있는 배열정보를 밀어버림.
      for (var i=0; i<this.devices.length; i++) {
        if (this.devices[i].pin === pin)
          	devices.splice(i,1);
      }
      return null;
	};
	//Wirted By Remoted 2016.04.17
  }

  function init() {
	
    // TEMPORARY WORKAROUND
    // Since _deviceRemoved is not used with Serial devices
    // ping device regularly to check connection
    pinger = setInterval(function() {		//setInterval 함수로 0.1초 단위로 6번을 핑을보내어 신호체크
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

  function queryFirmware() {
    //var output = new Uint8Array([START_SYSEX, QUERY_FIRMWARE, END_SYSEX]);
	//해당 함수에서는 QUERY FIRMWARE 를 확인하는 메세지를 전송만 하고, 받아서 처리하는 것은 processInput 에서 처리함
	//processInput 에서 query FIRMWARE 를 확인하는 메세지를 잡아서 조져야함

	var check_usb = checkSum( SCBD_CHOCOPI_USB, CPC_VERSION ),
		check_ble = checkSum( SCBD_CHOCOPI_BLE, CPC_VERSION );
	
	var usb_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_VERSION, check_usb ,END_SYSEX]),		//이 형태로 보내게되면 배열로 생성되어 한번에 감
		ble_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_VERSION, check_ble ,END_SYSEX]);
    
	device.send(usb_output.buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
	device.send(ble_output.buffer);		//ble 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 더 보냄
  }
  //Changed BY Remoted 2016.04.11
  //Patched BY Remoted 2016.04.15

	function checkSum(detailnport, data){
		var sum = detailnport;

		for(var i=0; i < data.length ; i++ ){
			sum ^= data[i];
		}
		return sum;
	}
	//Port/detail, data를 XOR 시킨 후, checksum 하여 return 시킴
	

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

	/* tryNextDevice -> processInput (Handler) -> processSysexMessage -> QUERY_FIRMWARE -> init -> QUERY_FIRMWARE 순으로 진행됨
											   -> QUERY_FIRWWARE 발송 
		init 에서 QUERY_FIRMWARE 에서 device 를 찾지 못할시 다시 부름으로써 무한루프가 형성됨								*/

  function processSysexMessage() {
	  // 시스템 처리 추가메세지
    switch(storedInputData[0]) {
      case SCBD_CHOCOPI_USB:				//SCBD_CHOCOPI_USB 혹은 BLE 가 들어오면 connect 확인이 완료
		//var check_start = checkSum(SCBD_CHOCOPI_USB, CPC_START);
		var check_get_block = checkSum(SCBD_CHOCOPI_USB, CPC_GET_BLOCK);

		//var output_start = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_START, check_start ,END_SYSEX]),		
		var	output_block = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_GET_BLOCK, check_get_block ,END_SYSEX]);

        if (!connected) {
          clearInterval(poller);		//setInterval 함수는 특정 시간마다 해당 함수를 실행
          poller = null;				//clearInterval 함수는 특정 시간마다 해당 함수를 실행하는 것을 해제시킴
          clearTimeout(watchdog);
          watchdog = null;				//감시견을 옆집 개나줘버림
          connected = true;
		  
		  //device.send(output_start.buffer);		
          setTimeout(init, 200);		//setTimeout 또한 일종의 타이머함수.. init 을 0.2 초후에 발동시킴.
		  
		  /* Connection 처리가 완료되었으므로, 이 곳에서 CPC_GET_BLOCK 에 대한 처리를 하는게 맞음 (1차 확인) -> (2차 확인 필요) */		
        }
		device.send(output_block.buffer);
        pinging = false;
        pingCount = 0;
        break;
	  case SCBD_CHOCOPI_BLE:
		//var check_start = checkSum(SCBD_CHOCOPI_BLE, CPC_START),
		var	check_get_block = checkSum(SCBD_CHOCOPI_BLE, CPC_GET_BLOCK);

		//var output_start = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_START, check_start ,END_SYSEX]),	
		var	output_block = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_GET_BLOCK, check_get_block ,END_SYSEX]);

        if (!connected) {
          clearInterval(poller);		
          poller = null;				
          clearTimeout(watchdog);
          watchdog = null;				
          connected = true;
		  
		  //device.send(output_start.buffer);		
          setTimeout(init, 200);			
		  device.send(output_block.buffer);
        }

		pinging = false;
        pingCount = 0;
		break;
		//펌웨어에 대한 연결을 허용시키는 부분
    }
  }


	function escape_control(source){
		if(source == 0x7E){
			var msg = new Uint8Array([0x7D, 0x7E ^ 0x20]);
			return msg;
		}else if (source == 0x7D){
			var msg = new Uint8Array([0x7D, 0x7D ^ 0x20]);
			return msg;
		}else{
			return source;
		}
	}
	/*
	이스케이프 컨트롤러 By Remoted 2016.04.13		-- 2016.04.14 패치완료	--> Detail 과 Port, 앞의 헤더와 테일러가 아닌이상 Data 들에 대해서는 반드시
	이스케이핑 컨트롤러를 거쳐서 데이터가 나가야만한다.
	http://m.blog.daum.net/_blog/_m/articleView.do?blogid=050RH&articleno=12109121 에 기반함 */

	function dec2hex(number){
		hexString = number.toString(16);
		return hexString;
	}

	function hex2dec(hexString){
		yourNumber = parseInt(hexString, 16);
		return yourNumber;
	}
	/*2 Byte -> 1 Byte 간으로 축약 및 재확장에 따라서 데이터 손실을 해결하기 위해서 함수제작 
	http://stackoverflow.com/questions/57803/how-to-convert-decimal-to-hex-in-javascript 

	*/

  function processInput(inputData) {
	  //입력 데이터 처리용도의 함수
    for (var i=0; i < inputData.length; i++) {
      if (parsingSysex) {
		if ((inputData[0] == SCBD_CHOCOPI_USB || inputData[0] == SCBD_CHOCOPI_BLE) && sysexBytesRead == 11) { //예상값) storedInputData[0] = 0xE0 혹은 0xF0
          parsingSysex = false;
          processSysexMessage();
		  //들어오는 데이터를 파싱하다가 END 값이 들어오면 파싱을 멈추고 시스템 처리 추가메세지 함수를 호출하여 처리시작
		  //호출하여 처리하는 검증과정 도중에서 QUERY_FIRMWARE CONNECTION 과정이 이루어짐
        }else{
			storedInputData[sysexBytesRead++] = inputData[i];
			console.log(inputData[i]);
			return;
		}
			/*	아두이노에서 사용하던 함수 원형 -> inputData[i] 번째에 대해서 테일러 값을 검증해서 System Message 를 파싱하고 있음
			if (inputData[i] == END_SYSEX) {
			  parsingSysex = false;
			  processSysexMessage();
			} else {
			  storedInputData[sysexBytesRead++] = inputData[i];
			  //기존의 아두이노의 방식에서는 이 과정을 통해서 AnalogMapping 등의 과정을 확보했음.
			}
			*/
			

      } else if ( waitForData > 0 && ( (inputData[0] >= 0xE0 && inputData[0] <= 0xE2) || (inputData[0] >= 0xF0 && inputData[0] <= 0xF2) ) && inputData[1] <= 0x0F ){					
																			// CPC_VERSION, “CHOCOPI”,1,0 ->  0, 1, “CHOCOPI”, CPC_VERSION 순으로 저장됨
	        storedInputData[--waitForData] = inputData[i];					//inputData 는 2부터 시작하므로, 2 1 0 에 해당하는 총 3개의 데이터가 저장됨
			if (executeMultiByteCommand !== 0 && waitForData === 0) {		//witForData 는 뒤에 올 데이터가 2개가 더 있다는 것을 뜻함
			  switch(executeMultiByteCommand) {								//executeMultiByteCommand == detail
				case CPC_VERSION:											//inputData 는 0부터 시작되지만, waitForData 는 큰수부터 시작되므로 역전현상이 발생함
					setVersion(storedInputData[1], storedInputData[0]);		
					break;																	
				case CPC_GET_BLOCK:															//				0 1 2  3 4 5 6 7		(포트)
					for(var i=1 ; i < storedInputData.length; i++ ){						//CPC_GET_BLOCK,8,9,0,12,0,0,0,0		(inputData)
						if (storedInputData[i] != 0){										//0, 0, 0, 0, 12, 0, 9, 8,CPC_GET_BLOCK	(storedInputData)
							connectHW(storedInputData[storedInputData.length - i], i-1);	//storedInputData.length 부터 순차적으로 감소 
							//connectHW (hw, pin)
						}
					}
					break;
				case SCBD_CHOCOPI_USB | 0x01:								//inputData[0] 번이 0xE1 인 경우, 차례적으로 포트(1Byte), 블록타입(1Byte) 가 전송됨
				case SCBD_CHOCOPI_BLE | 0x01:								//USB 연결 포트에 블록 연결시 가동됨
					connectHW(storedInputData[0], storedInputData[1]);		//0xE1, PORT, BLOCK_TYPE -> SCBD_SENSOR..		(inputData)
					break;													//BLOCK_TYPE -> SCBD_SENSOR, PORT, 0xE1			(storedInputData)
				case SCBD_CHOCOPI_USB | 0x02:								
				case SCBD_CHOCOPI_BLE | 0x02:								//inputData[0] 번이 0xE2 인 경우, 이어서 포트(1 Byte) 가 전송됨
					removeHW(storedInputData[0]);							//0xE2, PORT	(inputData)
					break;													//PORT, OxE2	(storedInputData)
			  }
			}
      } else if (waitForData > 0 && (inputData[0] == SCBD_CHOCOPI_USB | 0x0F) ){
		storedInputData[--waitForData] = inputData[i];					
		if (executeMultiByteCommand !== 0 && waitForData === 0) {		
			switch(executeMultiByteCommand) {								
				case SCBD_CHOCOPI_USB | 0x0F:								
				console.log('에러발생 ' + storedInputData[9] + storedInputData[8] + '에서 ' + storedInputData[7] + storedInputData[6] + storedInputData[5] + storedInputData[4] + storedInputData[3] + storedInputData[2] + storedInputData[1] + storedInputData[0]);
				return;	
				break;
				//오류코드 (2 Byte), 참고데이터 (8 Byte) -> 참고데이터 (8 Byte), 오류코드 (2 Byte)
			}
		}
      } else if (waitForData > 0 && inputData[0] == 0xF3 && inputData[1] <= 1) {
	    storedInputData[--waitForData] = inputData[i];
		if (executeMultiByteCommand !== 0 && waitForData === 0) {		//witForData 는 뒤에 올 데이터가 2개가 더 있다는 것을 뜻함
		  switch(executeMultiByteCommand) {
			case SCBD_CHOCOPI_BLE | 0x03:
				if (storedInputData[0] == 0) 							//연결해제됨
					ext._shutdown();									//0xF3, STATUS
				else if (storedInputData[0] == 1)						//STATUS, 0xF3
					ext._deviceConnected();
				
				break;
		  }
		}
	  } else if (waitForData > 0 && inputData[0] <= 0xBF) {	//0x80-> 0xBF
        storedInputData[--waitForData] = inputData[i];
        if (executeMultiByteCommand !== 0 && waitForData === 0) {			//0xE0 이상에 대한 값이 겹칠지라도, 초반 GET_BLOCK 확보 이후이므로 문제가 없음
          switch(executeMultiByteCommand) {									//겹치게 될 경우, inputData[1] 번에 오는 데이터로 판별해야함.
            case DIGITAL_MESSAGE:
              setDigitalInputs(multiByteChannel, (storedInputData[0] << 8) + storedInputData[1]);		
              break;
            case SCBD_SENSOR:																		// multiByteChannel, LOW, HIGH (inputData)
              setAnalogInput(multiByteChannel, (storedInputData[0] << 8) | storedInputData[1]);		// HIGH, LOW, multiByteChannel (storedInputData)
              break;
			case SCBD_TOUCH:																		// 들어오는 데이터가 1 Byte 인 경우
				if( i == 2 ){																		// multiByteChannel, Flag (on, off)	(inputData)
				}else if ( i == 1 ){																// Flag (on, off), multiByteChannel	(storedInputData)
				}
			  break;

			//이 곳에서 들어오는 command 에 대해서 추가하는 switch 들을 이루어내야함
			//다만 parsingSysex 가 필요없는 것에 대해 패치가 필요. -> parsingSysex 을 플래그로 사용하기로 함.
          }
		}	
      } else {
        if ((inputData[0] == 0xE0 || inputData[0] == 0xF0)  && (inputData[1] == CPC_VERSION || inputData[1] == CPC_GET_BLOCK)) {	//0xE0 인 경우, 초코파이보드 확정과정에서만 쓰임
			detail = inputData[1];	//예상 데이터) 0xE0, CPC_VERSION, “CHOCOPI”,1,0...
									//들어온 데이터를 분석해서 상위 4비트에 대해서는 command 로, 하위 4비트에 대해서는 multiByteChannel로 사용
									//일반적으로는 [1] 스택에 대하여 데이터가 리스팅되지만, CPC_VERSION 이나 GET_BLOCK 의 경우는 SYSTEM 명령어로써 데이터가옴
		} else if ((inputData[0] >= 0xE1 && inputData[0] <= 0xE2) || (inputData[0] >= 0xF1 && inputData[0] <= 0xF3) || inputData[0] == 0xEF) {
			detail = inputData[0];
        } else {														// 초반 펌웨어 확정과정 이후에, 나머지 디테일/포트합 최대는 0xBF 까지이므로 이 부분을 반드시 타게됨
		  detail = inputData[0] & 0xF0;									// 1. 문제는 디테일 0~ B 까지 사용하는 것에 대해서 어떤 센서가 사용하는지 확정하기 힘듬
          multiByteChannel = inputData[0] & 0x0F;						// -> hwList.search_bypin 로 조사해서 처리해야함
		  port = hwList.search_bypin(multiByteChannel);
        }
		switch (port.name)					//bypin 으로 역참조를 통해서 name 에 대해서 스위치분기를 시작시킴
		{
		  case SCBD_SENSOR:								//Detail/Port, 2 Byte = 3 Byte
		  	waitForData = 3;							//전위연산자를 통해서 저장하기 때문에 3 Byte 로 설정
			executeMultiByteCommand = port.name;
			break;
		  case SCBD_TOUCH:
		  case SCBD_SWITCH:
		  case SCBD_MOTION:
		  case SCBD_LED:
		  case SCBD_STEPPER:
		  case SCBD_STEPPER:
		  case SCBD_DC_MOTOR:	
		  case SCBD_SERVO:
		  case SCBD_ULTRASONIC:
		  case SCBD_PIR: 
			break;
		}

		switch(detail) {												/* 이 곳에서는 디테일과 포트의 분리만 이루어지며, 실질적인 처리는 위에서 처리함	*/
		  case DIGITAL_MESSAGE:
		  case ANALOG_MESSAGE:								
			waitForData = 2;
			executeMultiByteCommand = detail;
			break;

		  case CPC_VERSION:										
		  	parsingSysex = true;						//REPORT_VERSION (아두이노용) -> CPC_VERSION (초코파이보드용)
			sysexBytesRead = 0;
		  case SCBD_CHOCOPI_USB | 0x0F:					//오류보고용 처리
			waitForData = 11;							
			executeMultiByteCommand = detail;
			break;

		  case CPC_GET_BLOCK:						
			waitForData = 10;							
			executeMultiByteCommand = detail;
			break;
		  case SCBD_CHOCOPI_USB:					//연결용 디테일/포트가 오면 sysexBytesRead 에 대해서 0값으로 리셋을 날리고, 파싱용 플래그를 다시 원상복귀시킴.
		  case SCBD_CHOCOPI_BLE:
			parsingSysex = true;
			sysexBytesRead = 0;
			break;
		  case SCBD_CHOCOPI_USB | 0x01:					//0xE1 일 경우에, Detail/Port 에 이어서 2Byte 가 딸려옴 = 총 3 Byte
		  case SCBD_CHOCOPI_BLE | 0x01:					
			waitForData = 3;
			executeMultiByteCommand = detail;
			break;
		  case SCBD_CHOCOPI_USB | 0x02:					//일반적으로는 Detail/Port [0]  이후에 Data [1] 이 옴 = 총 2 Byte
		  case SCBD_CHOCOPI_BLE | 0x02:					
		  case SCBD_CHOCOPI_BLE | 0x03:					//0xF3 은 BLE 로 연결된 보드의 상태변경을 의미함
			waitForData = 2;
			executeMultiByteCommand = detail;
			break;
		  /*case CPC_STOP:								//CPC_STOP 의 경우는 waitForData 가 0이며 위에서 따로 처리 분기를 작성시켜줘야함
			waitForData = 0;
			_shutdown();
			break;*/
		}
      }
    }
  }

	function connectHW (hw, pin) {
		hwList.add(hw, pin);
	}
	//hwList.add 함수에 의거하여, hw 에 새로운 pin 이 지정되도록 이미 코딩되어 있음. (패치 미필요)

	function removeHW(pin){
		hwList.remove(pin);
	}
	

  function analogRead(pin) {
    if (pin >= 0 && 15 <= pin) {
      return Math.round((analogInputData[pin] * 100) / 1023);
    } else {
      var valid = [];
      for (var i = 0; i < 15; i++)
        valid.push(i);
      console.log('ERROR: valid analog pins are ' + valid.join(', '));
      return;
    }
  }

  function digitalRead(pin) {
	var hw = hwList.search_bypin(pin);

    if (!hw) {
      console.log('ERROR: valid input pins are not found');
      return;
    }
    return digitalInputData[pin];
  }

  function digitalWrite(pin, val) {
	var hw = hwList.search_bypin(pin);
    if (!hw) {
      console.log('ERROR: valid output pins are not found');
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

	//Original Function Line--------------------------------------------------------------------------
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
	//digitalWrite 에서 High 와 Low 는 상위비트와 하위비트를 나눠서 출력하는 듯 함?

  ext.digitalRead = function(pin) {
    return digitalRead(pin);
  };

  ext.whenDigitalRead = function(pin, val) {
    if (hasCapability(pin, INPUT)) {
      if (val == menus[lang]['outputs'][0])
        return digitalRead(pin);
      else if (val == menus[lang]['outputs'][1])
        return digitalRead(pin) === false;
    }
  };
	// menus[lang]['outputs'][1] outputs 는 켜기와 끄기를 의미하는데, 3차원 배열로 1번에 해당하는 것은 도대체 뭔지 1도 모르겟음!


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
	//led 에 대한 객체값 정의 확인불가..
	//setLED 와 changeLED 는 analogWrite 로 써지고 있는데, 이 부분에서 어떤걸 써야하는지 검증 불가..

	//함수의 인자는 블록에 표시된 갯수대로 가져온다.
	//Writed By Remoted 2016.04.14
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
  //HIGH 에 digitalWrite 시에는 LED 가 켜져있을 때 이고, val 은 밝기를 조절하는 듯 함
	//LOW 에 digitalWrite 시에는 LED가 꺼져있을 때 이고, val 은 밝기를 조절하는데 0으로 맞춤으로써 밝기를 날려버리는듯 함

  ext.whenButton = function(btn, state) {
    var hw = hwList.search(btn);
    if (!hw) return;
    if (state === 'pressed')
      return digitalRead(hw.pin);
    else if (state === 'released')
      return !digitalRead(hw.pin);
  };


  ext._getStatus = function() {
    if (!connected)
      return { status:1, msg:'Disconnected' };
    else
      return { status:2, msg:'Connected' };
	if(watchdog) return {status: 1, msg: 'Probing for ChocopieBoard'};
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

    device.open({ stopBits: 0, bitRate: 115200, ctsFlowControl: 0 });
    console.log('Attempting connection with ' + device.id);
    device.set_receive_handler(function(data) {
      var inputData = new Uint8Array(data);
      processInput(inputData);
    });
	//첫째로 processInput 핸들러를 가동시키고 나서

    poller = setInterval(function() {
      queryFirmware();
    }, 1000);
	//queryFirmware 를 가동시킴으로써 시스템 쿼리펌웨어에 대하여 메세지 확정처리르 거침

    watchdog = setTimeout(function() {
      clearInterval(poller);
      poller = null;
      device.set_receive_handler(null);
      device.close();
      device = null;
      tryNextDevice();
    }, 5000);
	// 5초마다 지속적으로 tryNextDevice 를 실행해줌으로써, 연결될때까지 무한루프를 가동하게됨
  }

  ext._shutdown = function() {
    // TODO: Bring all pins down
    if (device) device.close();
    if (poller) clearInterval(poller);
    device = null;
  };


	
	//Function added Line -----------------------------------------------------------------------------	BLE는 스크래치의 상호작용에서는 안쓰임
	
  ext.readSENSOR = function(networks, name) {
    var hw = hwList.search(SCBD_SENSOR),
		sensor_detail = new Uint8Array([0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x80]),
		low_data = escape_control(SAMPLING_RATE & LOW),
		high_data = escape_control(SAMPLING_RATE & HIGH);

	var	check_low = 0,
		check_high = 0;

	var	dnp = new Uint8Array([sensor_detail[0] | hw.pin, sensor_detail[1] | hw.pin, sensor_detail[2] | hw.pin, sensor_detail[3] | hw.pin, sensor_detail[4] | hw.pin, sensor_detail[5] | hw.pin, sensor_detail[6]| hw.pin]);	//detail and port
	//온도, 습도, 조도, 아날로그 1, 2, 3, 4, 정지명령 순서 --> 정지명령은 쓸 재간이 없음.


    if (!hw) return;	
	else {
		if (networks === menus[lang]['networks'][0] || networks === menus[lang]['networks'][1])		//일반과 무선 둘다 처리가능
		{
			for (var i=0;i < dnp.length ; i++)
			{
				if (name === menus[lang]['hwIn'][i])
				{
					check_low = checkSum( dnp[i], low_data );
					check_high = checkSum( dnp[i], high_data );

				var sensor_output_low = new Uint8Array([START_SYSEX, dnp[i], low_data, check_low ,END_SYSEX]),
					sensor_output_high = new Uint8Array([START_SYSEX, dnp[i], high_data, check_high ,END_SYSEX]);

				device.send(sensor_output_low.buffer);
				device.send(sensor_output_high.buffer);
			
				}
			}
		}
	}
	return analogRead(hw.pin);
  };
  //readSENSOR 에 대하여 검증필요->내용 확인 완료 (light Sensor 또한 Analog) -- Changed By Remoted 2016.04.14

  ext.isTouchButtonPressed = function(networks, button){
	  var hw = hwList.search(SCBD_TOUCH),
		  sensor_detail = new Uint8Array([0x00, 0x10, 0x20]);

	  if(!hw) return;
	  else{
		  if (networks === menus[lang]['networks'][0] || networks === menus[lang]['networks'][1])
		  {
			digitalRead(hw.pin);
		  }
	  }

  };

  ext.motionbRead = function(networks,value){
  };

  ext.photoGateRead = function(networks,photogate,gatestate){
  };

  ext.passLEDrgb = function(networks,ledposition,r,g,b){
  };

  ext.passBUZEER = function(networks,pitch,playtime){
  };

  ext.passSteppingAD = function(networks,steppingMotor,speed,direction){
  };

  ext.passSteppingADA = function(networks,steppingMotor,speed,direction,rotation_amount){
  };

  ext.passDCAD = function(networks,dcmotor,speed,direction){
  };


	//Function added Line - end  --------------------------------------------------------------------------------------

	
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