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
    TOTAL_PIN_MODES = 11;		//총 가능한 PIN MODE 13 (아두이노) -> 11 (초코파이) 용으로 변경

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

	//Writed By Remoted 2016.04.17
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
	
	/*
    for (var i = 0; i < 16; i++) {
      var output = new Uint8Array([REPORT_DIGITAL | i, 0x01]);
      device.send(output.buffer);
	  //0xD0 ~ 0xDF 까지 OR 연산후에 0x01 값과 함께 배열로써 보냄.. -> 초기화 작업으로 추측 --> 정확했음
    }
	*/

	/*
	var check = checkSum(SCBD_CHOCOPI_USB);
	var usb_output = new Uint8Array([START_SYSEX, CPC_VERSION, SCBD_CHOCOPI_USB, check ,END_SYSEX]);		//이 형태로 보내게되면 배열로 생성되어 한번에 감
    device.send(usb_output.buffer);
	
	if (storedInputData[0] != 0x00)
	{
		check = checkSum(SCBD_CHOCOPI_BLE);
		var ble_output = new Uint8Array([START_SYSEX, CPC_VERSION, SCBD_CHOCOPI_BLE, check ,END_SYSEX]);
		device.send(ble_output.buffer);
	}*/

    //queryCapabilities();
	//쿼리의 상태를 확인하기위해 함수 가동
	/*http://www.firmata.org/wiki/V2.3ProtocolDetails#Query_Firmware_Name_and_Version 에 의하면 GUI 기반에서 현재 보드의 상태등을 알아보기 위하여
	FIRMATA 와 체크를 하기위해 사용되어지는 부분으로 필요없음*/

	/* 엄연히 말하면 init 은 processSysexMessage 안에서 QUERY_FIRMWARE 일때 실행되어짐 */


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

  function hasCapability(pin, mode) {
    if (pinModes[mode].indexOf(pin) > -1)
      return true;
    else
      return false;
  }

  function queryFirmware() {
    //var output = new Uint8Array([START_SYSEX, QUERY_FIRMWARE, END_SYSEX]);
	//해당 함수에서는 QUERY FIRMWARE 를 확인하는 메세지를 전송만 하고, 받아서 처리하는 것은 processInput 에서 처리함
	//processInput 에서 query FIRMWARE 를 확인하는 메세지를 잡아서 조져야함

	var check = checkSum( SCBD_CHOCOPI_USB << 8 | CPC_VERSION);
	
	var usb_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_VERSION, check ,END_SYSEX]);		//이 형태로 보내게되면 배열로 생성되어 한번에 감
	var	ble_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_VERSION, check ,END_SYSEX]);
    
	device.send(usb_output.buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
	device.send(ble_output.buffer);		//ble 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 더 보냄
  }
  //Changed BY Remoted 2016.04.11
  //Patched BY Remoted 2016.04.15

	function checkSum(buffer){
		var sum;
		for(var i=0; i < buffer.length ; i++ ){
			sum ^= buffer[i];
		}
		return sum;
	}
	//Port/detail, data를 checksum 함
	


  function queryCapabilities() {
    console.log('Querying ' + device.id + ' capabilities');
    var msg = new Uint8Array([
        START_SYSEX, CAPABILITY_QUERY, END_SYSEX]);
	device.send(msg.buffer);
	//디바이스가 유효한지 확인하기 위해서 Capabilities 함수를 가동하여 패킷을 보냄
  }

  function queryAnalogMapping() {
    console.log('Querying ' + device.id + ' analog mapping');
    var msg = new Uint8Array([
        START_SYSEX, ANALOG_MAPPING_QUERY, END_SYSEX]);
    device.send(msg.buffer);
  }
  // 아날로그 매핑 쿼리는 핀에 아날로그 검증패킷을 보냄으로써 디지털 쿼리가 아니라 실제적으로 아날로그 처리를 할 수 있는지 검증함


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
	  // 시스템 처리 추가메세지 ? 라는 정의인 듯 함. storedInputData[0] 번에 대해서 크게 3가지 처리를 나열함
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
      case SCBD_CHOCOPI_USB:				//SCBD_CHOCOPI_USB 혹은 BLE 가 들어오면 connect 확인이 완료
		var check_start = checkSum(SCBD_CHOCOPI_USB << 8 | CPC_START);
			check_get_block = checkSum(SCBD_CHOCOPI_USB << 8 | CPC_GET_BLOCK);

		var output_start = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_START, check_start ,END_SYSEX]);		
			output_block = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_GET_BLOCK, check_get_block ,END_SYSEX]);

        if (!connected) {
          clearInterval(poller);		//setInterval 함수는 특정 시간마다 해당 함수를 실행
          poller = null;				//clearInterval 함수는 특정 시간마다 해당 함수를 실행하는 것을 해제시킴
          clearTimeout(watchdog);
          watchdog = null;				//감시견을 옆집 개나줘버림
          connected = true;
		  
		  device.send(output_start.buffer);		
		  device.send(output_block.buffer);
          setTimeout(init, 200);		//setTimeout 또한 일종의 타이머함수.. init 을 0.2 초후에 발동시킴.
		  
		  /* Connection 처리가 완료되었으므로, 이 곳에서 CPC_GET_BLOCK 에 대한 처리를 하는게 맞음 (1차 확인) -> (2차 확인 필요) */		
        }
        pinging = false;
        pingCount = 0;
        break;
	  case SCBD_CHOCOPI_BLE:
		var check_start = checkSum(SCBD_CHOCOPI_BLE << 8 | CPC_START);
			check_get_block = checkSum(SCBD_CHOCOPI_BLE << 8 | CPC_GET_BLOCK);

		var output_start = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_START, check_start ,END_SYSEX]);		
			output_block = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_BLE, CPC_GET_BLOCK, check_get_block ,END_SYSEX]);

        if (!connected) {
          clearInterval(poller);		
          poller = null;				
          clearTimeout(watchdog);
          watchdog = null;				
          connected = true;
		  
		  device.send(output_start.buffer);		
		  device.send(output_block.buffer);
          setTimeout(init, 200);			
        }

		pinging = false;
        pingCount = 0;
		break;
		//펌웨어에 대한 연결을 허용시키는 부분
    }
  }


	function escapte_control(source){
		for(var i=0; i < source.length; i++){
			if(source[i] == 0x7E){
				var msg = new Uint8Array([0x7D, 0x7E ^ 0x20]);
				return msg;
			}else if (source[i] == 0x7D){
				var msg = new Uint8Array([0x7D, 0x7D ^ 0x20]);
				return msg;
			}
			else{
				return source;
			}
		}
	}
	//이스케이프 컨트롤러 By Remoted 2016.04.13		-- 2016.04.14 패치완료
	//http://m.blog.daum.net/_blog/_m/articleView.do?blogid=050RH&articleno=12109121 에 기반함


  function processInput(inputData) {
	  //입력 데이터 처리용도의 함수
    for (var i=0; i < inputData.length; i++) {
      if (parsingSysex) {
			/*	아두이노에서 사용하던 함수 원형 -> inputData[i] 번째에 대해서 테일러 값을 검증해서 System Message 를 파싱하고 있음
			if (inputData[i] == END_SYSEX) {
			  parsingSysex = false;
			  processSysexMessage();
			} else {
			  storedInputData[sysexBytesRead++] = inputData[i];
			  //기존의 아두이노의 방식에서는 이 과정을 통해서 AnalogMapping 등의 과정을 확보했음.
			}
			*/
			
        if ((inputData[0] == SCBD_CHOCOPI_USB || inputData[0] == SCBD_CHOCOPI_BLE) && inputData[inputData.length] != 0) {
		  storedInputData[sysexBytesRead++] = inputData[i];		//예상값) storedInputData[0] = 0xE0 혹은 0xF0
          parsingSysex = false;
          processSysexMessage();
		  //들어오는 데이터를 파싱하다가 END 값이 들어오면 파싱을 멈추고 시스템 처리 추가메세지 함수를 호출하여 처리시작
		  //호출하여 처리하는 검증과정 도중에서 QUERY_FIRMWARE CONNECTION 과정이 이루어짐
        }
      } else if (waitForData > 0 && ((inputData[0] >= 0xE0 && inputData[0] <= 0xE2) || (inputData[0] >= 0xF1 && inputData[0] <= 0xF2)) && inputData[1] <= 0x0F){					
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
      } else if (waitForData > 0 && (inputData[0] == SCBD_CHOCOPI_USB | 0x0F)){
	        storedInputData[--waitForData] = inputData[i];					
			if (executeMultiByteCommand !== 0 && waitForData === 0) {		
			  switch(executeMultiByteCommand) {								
				case SCBD_CHOCOPI_USB | 0x0F:								
					console.log('에러발생 ' + storedInputData[9] + storedInputData[8] + '에서 ' + storedInputData[7] + storedInputData[6] + storedInputData[5] + storedInputData[4] + storedInputData[3] + storedInputData[2] + storedInputData[1] + storedInputData[0]);							
					//오류코드 (2 Byte), 참고데이터 (8 Byte) -> 참고데이터 (8 Byte), 오류코드 (2 Byte)
					break;
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
	  } else if (waitForData > 0 && inputData[i] < 0xFF) {	//0x80-> 0xFF
        storedInputData[--waitForData] = inputData[i];
        if (executeMultiByteCommand !== 0 && waitForData === 0) {			//0xE0 이상에 대한 값이 겹칠지라도, 초반 GET_BLOCK 확보 이후이므로 문제가 없음
          switch(executeMultiByteCommand) {									//겹치게 될 경우, inputData[1] 번에 오는 데이터로 판별해야함.
            case DIGITAL_MESSAGE:
              setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);		
              break;
            case ANALOG_MESSAGE:
              setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);
              break;

			//이 곳에서 들어오는 command 에 대해서 추가하는 switch 들을 이루어내야함
			//다만 parsingSysex 가 필요없는 것에 대해 패치가 필요. -> parsingSysex 을 플래그로 사용하기로 함.
          }
      } else {
        if (inputData[0] == 0xE0 && (inputData[1] == CPC_VERSION || inputData[1] == CPC_GET_BLOCK)) {	//0xE0 인 경우, 초코파이보드 확정과정에서만 쓰임
			detail = inputData[1];	//예상 데이터) 0xE0, CPC_VERSION, “CHOCOPI”,1,0...
									//들어온 데이터를 분석해서 상위 4비트에 대해서는 command 로, 하위 4비트에 대해서는 multiByteChannel로 사용
									//일반적으로는 [1] 스택에 대하여 데이터가 리스팅되지만, CPC_VERSION 이나 GET_BLOCK 의 경우는 SYSTEM 명령어로써 데이터가옴
		} else if (inputData[0] == 0xE1 || inputData[0] == 0xE2 || inputData[0] == 0xF1 || inputData[0] == 0xF2 || inputData[0] == 0xF3 || inputData[0] == 0xEF) {
			detail = inputData[0];
        }else {
		  detail = inputData[0] & 0xF0;					//command -> detail
          multiByteChannel = inputData[0] & 0x0F;		//multiByteChannel -> port
        }
        switch(detail) {								/* 이 곳에서는 디테일과 포트의 분리만 이루어지며, 실질적인 처리는 위에서 처리함	*/
          case DIGITAL_MESSAGE:
          case ANALOG_MESSAGE:								
			waitForData = 2;
            executeMultiByteCommand = detail;
            break;
          case CPC_VERSION:								//REPORT_VERSION (아두이노용) -> CPC_VERSION (초코파이보드용)
		  case SCBD_CHOCOPI_USB | 0x0F:					//오류보고용 처리
            waitForData = 10;							
            executeMultiByteCommand = detail;
            break;
		  case CPC_GET_BLOCK:						
            waitForData = 9;							
            executeMultiByteCommand = detail;
            break;
		  case SCBD_CHOCOPI_USB:					//연결용 디테일/포트가 오면 sysexBytesRead 에 대해서 0값으로 리셋을 날리고, 파싱용 플래그를 다시 원상복귀시킴.
		  case SCBD_CHOCOPI_BLE:
            parsingSysex = true;
            sysexBytesRead = 0;
            break;
		  case SCBD_CHOCOPI_USB | 0x01:					//0xE1 일 경우에, Detail/Port 에 이어서 2Byte 가 딸려옴
		  case SCBD_CHOCOPI_BLE | 0x01:
			waitForData = 2;
		    executeMultiByteCommand = detail;
			break;
		  case SCBD_CHOCOPI_USB | 0x02:					//일반적으로는 Detail/Port [0]  이후에 Data [1] 이 오기 때문에, waitForData 를 1로 설정
		  case SCBD_CHOCOPI_BLE | 0x02:
		  case SCBD_CHOCOPI_BLE | 0x03:					//0xF3 은 BLE 로 연결된 보드의 상태변경을 의미함
			waitForData = 1;
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
	
  function pinMode(pin, mode) {
    var msg = new Uint8Array([PIN_MODE, pin, mode]);
    device.send(msg.buffer);
  }
	//해당 핀으로 핀의 모드를 알려주고 셋팅함.

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

  ext.changeLED = function(led, val) {
    var hw = hwList.search(led);
    if (!hw) return;
    var b = hw.val + val;
    if (b < 0) b = 0;
    else if (b > 100) b = 100;
    analogWrite(hw.pin, b);
    hw.val = b;
  };
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

  ext.readInput = function(networks, name) {
    var hw = hwList.search(SCBD_SENSOR);
    if (!hw) return;	
	//if (name == 'Analog 1' || name == 'Analog 2' || name == 'Analog 3' || name == 'Analog 4' || name == '아날로그 1' || name == '아날로그 2' || name == '아날로그 3' || name == '아날로그 4')
	//{
		return analogRead(hw.pin);
	//}else{
	//	return digitalRead(hw.pin);
	//}
    
  };
	//readInput 에 대하여 검증필요->내용 확인 완료 -- Changed By Remoted 2016.04.14

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


	
	//Function added Line -----------------------------------------------------------------------------
  ext.isTouchButtonPressed = function(networks,value){
	 if(networks == "일반"){
		var hw = hwList.search(touch);
		if (!hw) return;
		return value;
	 }else{
	 }
  };

  ext.motionbRead = function(networks,value){
	 if(networks == "일반"){
		 var hw = hwList.search(motion);
		 if (!hw) return;
		 return value;
	 }else{
	 }
  };

  ext.photoGateRead = function(networks,photogate,gatestate){
	 if(networks == "일반"){
	    var hw = hwList.search(photogate);
		if (!hw) return;
		return gatestate;
	 }else{
	 }
  };

  ext.passLEDrgb = function(networks,ledposition,r,g,b){
	var hw = hwList.search(led);
	if(!hw) return;
	var datas = 0;
	datas = 0x7E;
	datas = datas << 4 | 0;				//디테일
	datas = datas << 4 | 0;				//포트
	datas = datas << 8 | ledposition;
	datas = datas << 8 | r;
	datas = datas << 8 | g;
	datas = datas << 8 | b;
	datas = datas << 8 | 0x7E;
	
	 if(networks == "일반"){
		 digitalWrite(hw.pin,datas);
	 }else{
	 }
  };

  ext.passBUZEER = function(networks,pitch,playtime){
	var hw = hwList.search(BUZEER);//아직 연결 하는 객체를 찾지못해서 임시로 사용
	if(!hw) return;
	var datas = 0;	  
	datas = 0x7E;
	datas = datas << 4 | 8;				//디테일
	datas = datas << 4 | 0;				//포트
	datas = datas << 8 | pitch;
    datas = datas << 32 | playtime;
	datas = datas << 8 | 0x7E;
	  
	 if(networks == "일반"){
		 digitalWrite(hw.pin,datas);
	 }else{
	 }
  };

  ext.passSteppingAD = function(networks,steppingMotor,speed,direction){
	var hw = hwList.search(STEPPER);//아직 연결 하는 객체를 찾지못해서 임시로 사용
	if(!hw) return;
	var datas = 0;
	datas = 0x7E;
	datas = datas << 4 | 0;				//디테일
	datas = datas << 4 | 0;				//포트
	datas = datas << 8 | steppingMotor;
    datas = datas << 16 | speed;
	datas = datas << 8 | 0x7E;
	
	 if(networks == "일반"){
		 digitalWrite(hw.pin,datas);
	 }else{
	 }
  };

  ext.passSteppingADA = function(networks,steppingMotor,speed,direction,rotation_amount){
	var hw = hwList.search(STEPPER);//아직 연결 하는 객체를 찾지못해서 임시로 사용
	if(!hw) return;
	var datas = 0;
	datas = 0x7E;
	datas = datas << 4 | 1;				//디테일
	datas = datas << 4 | 0;				//포트
	datas = datas << 8 | steppingMotor;
    datas = datas << 16 | speed;
	datas = datas << 32 | direction;
	datas = datas << 8 | 0x7E;
	
	 if(networks == "일반"){
		 digitalWrite(hw.pin,datas);
	 }else{
	 }
  };

  ext.passDCAD = function(networks,dcmotor,speed,direction){
	var hw = hwList.search(DC);//아직 연결 하는 객체를 찾지못해서 임시로 사용
	if(!hw) return;
	var datas = 0;
	datas = 0x7E;
	datas = datas << 4 | direction;				//디테일
	datas = datas << 4 | 0;				//포트
	datas = datas << 16 | speed;

	//수정해야 될것 같음 ppt 그림에서는 시계,반시계로 정의되어있음
	if (direction == 0)
	{
		datas = datas << 8 | 0;
	}else{
		datas = datas << 8 | 1;	  
	}
	datas = datas << 8 | 0x7E;
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
      //[' ', 'connect %m.hwOut to pin %n', 'connectHW', 'led A', 3],
      //[' ', 'connect %m.hwIn to analog %n', 'connectHW', 'rotation knob', 0],
      //['-'],
      //[' ', 'set %m.leds %m.outputs', 'digitalLED', 'led A', 'on'],
      //[' ', 'set %m.leds brightness to %n%', 'setLED', 'led A', 100],
      //[' ', 'change %m.leds brightness by %n%', 'changeLED', 'led A', 20],
      ['-'],
      [' ', '%m.networks %m.servosport %m.servos to %n degrees', 'rotateServo', 'normal', 'Port 1', 'Servo 1', 180],
      //[' ', 'rotate %m.servos by %n degrees', 'changeServo', 'servo A', 20],
      ['-'],
      ['r', 'read from %m.networks to %m.hwIn', 'readInput', 'normal','light sensor'],		//light, temperature, humidity and analog sensor combined (normal, remote)
      ['-'],																				//function_name: readInput
      //[' ', 'set pin %n %m.outputs', 'digitalWrite', 1, 'on'],
      //[' ', 'set pin %n to %n%', 'analogWrite', 3, 100],
      //['-'],
      //['h', 'when pin %n is %m.outputs', 'whenDigitalRead', 1, 'on'],
      //['b', 'pin %n on?', 'digitalRead', 1],
      //['-'],
      //['h', 'when analog %m.analogSensor %m.ops %n%', 'whenAnalogRead', 1, '>', 50],
      //['r', 'read analog %m.analogSensor', 'analogRead', 0],
	  //['h', 'when remoted analog %m.RanalogSensor %m.ops %n%', 'whenRAnalogRead', 1, '>', 50],
      //['r', 'read remoted analog %m.RanalogSensor', 'RAnalogRead', 0],		//Patched
      ['-'],
      //['r', 'map %n from %n %n to %n %n', 'mapValues', 50, 0, 100, -240, 240],
	  //['-'],
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
      //[' ', '%m.hwOut 를 %n 번 핀에 연결하기', 'connectHW', 'led A', 3],
      //[' ', '%m.hwIn 를 아날로그 %n 번 핀에 연결하기', 'connectHW', '회전 손잡이', 0],
      //['-'],
      //[' ', '%m.leds 를 %m.outputs', 'digitalLED', 'led A', '켜기'],
      //[' ', '%m.leds 의 밝기를 %n% 로 설정하기', 'setLED', 'led A', 100],
      //[' ', '%m.leds 의 밝기를 %n% 만큼 바꾸기', 'changeLED', 'led A', 20],
      ['-'],
      [' ', '%m.networks %m.servosport %m.servos 각도 %n', 'rotateServo', '일반', '포트 1', '서보모터 1', 180],	//ServoMotor, Multiple Servo and Remote Servo is defined.
      ['-'],																						
      ['r', '%m.networks 센서블록 %m.hwIn 의 값', 'readInput', '일반','조도'],			// 조도, 온도, 습도, 아날로그 통합함수 (일반, 무선)
      ['-'],																			// function_name = readInput
      //[' ', '%n 번 핀을 %m.outputs', 'digitalWrite', 1, '켜기'],
      //[' ', '%n 번 핀의 값을 %n% 로 설정하기', 'analogWrite', 3, 100],
      //['-'],
      //['h', '%n 번 핀의 상태가 %m.outputs 일 때', 'whenDigitalRead', 1, '켜기'],
      //['b', '%n 번 핀이 켜져있는가?', 'digitalRead', 1],
      //['-'],
      //['h', '아날로그 %m.analogSensor 번의 값이 %m.ops %n% 일 때', 'whenAnalogRead', 1, '>', 50],
      //['r', '아날로그 %m.analogSensor 번의 값', 'analogRead', 0],
	  //['h', '원격 아날로그 %m.RanalogSensor 번의 값이 %m.ops %n% 일 때', 'whenRAnalogRead', 1, '>', 50],
      //['r', '원격 아날로그 %m.RanalogSensor 번의 값', 'RAnalogRead', 0],	//Patched 
      //['-'],
      //['r', '%n 을(를) %n ~ %n 에서 %n ~ %n 의 범위로 바꾸기', 'mapValues', 50, 0, 100, -240, 240],
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

		hwIn: ['light sensor', 'temperature sensor', 'humidity sensor', 'Analog 1', 'Analog 2', 'Analog 3', 'Analog 4'],						
		//Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		//hwOut: ['led A', 'led B', 'led C', 'led D', 'button A', 'button B', 'button C', 'button D', 'servo A', 'servo B', 'servo C', 'servo D'], 
		//To out Hardware Value 
		/*
		leds: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
			'11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
			'21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
			'31', '32', '33', '34', '35', '36', '37', '38', '39', '40',
			'41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
			'51', '52', '53', '54', '55', '56', '57', '58', '59', '60',
			'61', '62', '63', '64', '65', '66', '67', '68', '69', '70',
			'71', '72', '73', '74', '75', '76', '77', '78', '79', '80',
			'81', '82', '83', '84', '85', '86', '87', '88', '89', '90',
			'91', '92', '93', '94', '95', '96', '97', '98', '99', '100',
			'101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
			'111', '112', '113', '114', '115', '116', '117', '118', '119', '120',
			'121', '122', '123', '124', '125', '126', '127', '128', '129', '130',
			'131', '132', '133', '134', '135', '136', '137', '138', '139', '140',
			'141', '142', '143', '144', '145', '146', '147', '148', '149', '150',
			'151', '152', '153', '154', '155', '156', '157', '158', '159', '160',
			'161', '162', '163', '164', '165', '166', '167', '168', '169', '170',
			'171', '172', '173', '174', '175', '176', '177', '178', '179', '180',
			'181', '182', '183', '184', '185', '186', '187', '188', '189', '190',
			'191', '192', '193', '194', '195', '196', '197', '198', '199', '200',
			'201', '202', '203', '204', '205', '206', '207', '208', '209', '210',
			'211', '212', '213', '214', '215', '216', '217', '218', '219', '220',
			'221', '222', '223', '224', '225', '226', '227', '228', '229', '230',
			'231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
			'241', '242', '243', '244', '245', '246', '247', '248', '249', '250',
			'251', '252', '253', '254', '255'],*/
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


		hwIn: ['조도', '온도', '습도','아날로그 1', '아날로그 2', '아날로그 3', '아날로그 4'],
		// light, temperature and humidity and Analog Sensor for 1, 2, 3 and 4 is defined.

		//hwOut: ['led A', 'led B', 'led C', 'led D', '버튼 A', '버튼 B', '버튼 C', '버튼 D', '서보모터 A', '서보모터 B', '서보모터 C', '서보모터 D'],
		/*leds: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
			'11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
			'21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
			'31', '32', '33', '34', '35', '36', '37', '38', '39', '40',
			'41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
			'51', '52', '53', '54', '55', '56', '57', '58', '59', '60',
			'61', '62', '63', '64', '65', '66', '67', '68', '69', '70',
			'71', '72', '73', '74', '75', '76', '77', '78', '79', '80',
			'81', '82', '83', '84', '85', '86', '87', '88', '89', '90',
			'91', '92', '93', '94', '95', '96', '97', '98', '99', '100',
			'101', '102', '103', '104', '105', '106', '107', '108', '109', '110',
			'111', '112', '113', '114', '115', '116', '117', '118', '119', '120',
			'121', '122', '123', '124', '125', '126', '127', '128', '129', '130',
			'131', '132', '133', '134', '135', '136', '137', '138', '139', '140',
			'141', '142', '143', '144', '145', '146', '147', '148', '149', '150',
			'151', '152', '153', '154', '155', '156', '157', '158', '159', '160',
			'161', '162', '163', '164', '165', '166', '167', '168', '169', '170',
			'171', '172', '173', '174', '175', '176', '177', '178', '179', '180',
			'181', '182', '183', '184', '185', '186', '187', '188', '189', '190',
			'191', '192', '193', '194', '195', '196', '197', '198', '199', '200',
			'201', '202', '203', '204', '205', '206', '207', '208', '209', '210',
			'211', '212', '213', '214', '215', '216', '217', '218', '219', '220',
			'221', '222', '223', '224', '225', '226', '227', '228', '229', '230',
			'231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
			'241', '242', '243', '244', '245', '246', '247', '248', '249', '250',
			'251', '252', '253', '254', '255'],*/

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