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
 *It have been writed by TaeHui Lee through KOREA SCIENCE.
 */

(function(ext) {

	var SCBD_CHOCOPI = 0x10,
		SCBD_CHOCOPI_USB = 0xE0,	//Chocopie USB 연결에 대한 값 디테일(상위값 14, 포트0) 을 지정
		SCBD_CHOCOPI_USB_PING = 0xE4,
		SCBD_CHOCOPI_BLE = 0xF0,	//Chocopie BLE 연결에 대한 값 디테일(상위값 15, 포트0) 를 지정	
		SCBD_CHOCOPI_BLE_PING = 0xF4,
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
	
  var SENSOR_REPOTER = 0,
	  TOUCH_REPOTER = 0,
	  SWITCH_REPOTER = 0,
	  MOTION_REPOTER = 0,
	  START_SYSEX = 0x7E,			//메세지의 시작패킷을 알리는 헤더		이스케이핑 필수
	  END_SYSEX = 0x7E;			//메세지의 꼬리패킷을 알리는 테일러		이스케이핑 필수

  var SAMPLING_RATE = 0x0080;

  var LOW = 0x00FF,
    HIGH = 0xFF00;
	//LOW, HIGH 를 연산하기 위해서 패치함 -- 2016.04.20 
  var MAX_DATA_BYTES = 4096;

  var parsingSysex = false,
    waitForData = 0,
    executeMultiByteCommand = 0,
    multiByteChannel = 0,
    sysexBytesRead = 0,
	port = 0,
    storedInputData = new Uint8Array(MAX_DATA_BYTES);

  var digitalOutputData = new Uint8Array(16),
    digitalInputData = new Uint8Array(16),
    analogInputData = new Uint16Array(16),			
	SanalogInputData = new Int8Array(16);

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
      //var device = this.search(dev);
	  var device_hooker = this.search_bypin(pin);

      if (!device_hooker) {										//SCBD_SERVO는 여러개가 삽입 될 수 있음. 2016.04.27 패치
        device = {name: dev, pin: pin, val: 0};					//이름이 SCBD_SERVO 이면서 핀이 비어있다면 추가. 2016.04.29 패치
        this.devices.push(device);								//SCBD_SERVO 이외에도 여러개의 모듈이 총 2개씩 삽입되어질 수 있음. 
																//이름이 아닌 pin으로 검색해서 처리해야함.		2016.05.03 패치
      } else {
		//device.pin = pin;
		device.name = dev;
	    device.val = 0;
      }
    };
	/* search 에서 device 가 존재하지 않는다면,  name, pin, val 을 배열로 묶어서 한번에 잘 추가시킴 
		 -> CPC_GET_BLOCK 을 처리하는 과정에서 0이 아닌경우에만 추가하므로 문제가 되지않음
		device 가 존재한다면, pin, val 만 추가시킴 -> name 의 값을 유지시킴. (remove 후에 다시 connect 시키는 과정에서 구성시킴)
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

    this.search_normal = function(dev){
	
    for (var i=0; i<this.devices.length; i++) {
      if (this.devices[i].name === dev && (this.devices[i].pin >= 0 && this.devices[i].pin <= 7))
        return this.devices[i];			
    }
	return null;
    };

    this.search_ble = function(dev){

    for (var i=0; i<this.devices.length; i++) {
		if (this.devices[i].name === dev && (this.devices[i].pin >= 8 && this.devices[i].pin <= 15))
			return this.devices[i];			
	}
	return null;
    };
	//Writed By Remoted 2016.05.03
	
	
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
	// setInterval 함수로 10초 단위로 6번을 핑을보내어 신호체크
    pinger = setInterval(function() {		
      if (pinging) {
        if (++pingCount > 6) {
          clearInterval(pinger);
          pinger = null;
          connected = false;
          if (device) device.close();
          device = null;
		  console.log('ping count ' + pingCount );
		  console.log('device ping over');
          return;
        }
      } else {
        if (!device) {
          clearInterval(pinger);
          pinger = null;
          return;
        }
        chocopie_ping();				//패치가 완료되면 이 부분을 주석해제, queryFirmware(); 를 제거시킴 -- 2016.04.25
        pinging = true;
      }
    }, 10000);
  }

  function chocopie_ping(){
	var usb_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB_PING, 0x1B ,END_SYSEX]);
	device.send(usb_output.buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
  }

  function queryFirmware() {
	var check_usb = checkSum( SCBD_CHOCOPI_USB, CPC_VERSION );
	
	var usb_output = new Uint8Array([START_SYSEX, SCBD_CHOCOPI_USB, CPC_VERSION, check_usb ,END_SYSEX]);
	device.send(usb_output.buffer);		//usb 연결인지 확인하기 위해서 FIRMWARE QUERY 를 한번 보냄
	console.log("queryFirmware sended");
  }
  //Changed BY Remoted 2016.04.11
  //Patched BY Remoted 2016.04.15

	function checkSum(detailnport, data){
		var sum = 0xFF ^ detailnport;
		sum ^= data;
		
		return sum;
	}
	//Port/detail, data를 XOR 시킨 후, checksum 하여 return 시킴	--> check Sum Success 2016.04.21
	

  function setDigitalInputs(portNum, portData) {
    digitalInputData[portNum] = portData;
  }

  function setAnalogInput(pin, val) {
    analogInputData[pin] = val;
  }

  function setSAnalogInput(pin, val) {
	SanalogInputData[pin] = val;	
  }

  function setVersion(major, minor) {
    majorVersion = major;
    minorVersion = minor;
  }

	/* tryNextDevice -> processInput (Handler) -> processSysexMessage -> init -> QUERY_FIRMWARE(PING) 순으로 진행됨
					 -> QUERY_FIRWWARE 발송 
		init 에서 QUERY_FIRMWARE 에서 device 를 찾지 못할시 다시 부름으로써 핑이 형성됨								*/

/*
  function processSysexMessage() {
	  // 시스템 처리 추가메세지
	console.log('I am comming processSysexMessage and storedInputData[0] is' + storedInputData[0]);

    if(rb === SCBD_CHOCOPI_USB) {
		//console.log('I am comming processSysexMessage SCBD_CHOCOPI_USB');
        if (!connected) {
          clearInterval(poller);		//setInterval 함수는 특정 시간마다 해당 함수를 실행
          poller = null;				//clearInterval 함수는 특정 시간마다 해당 함수를 실행하는 것을 해제시킴
          clearTimeout(watchdog);
          watchdog = null;				//감시견을 옆집 개나줘버림
          connected = true;

          setTimeout(init, 200);
		  sysexBytesRead = 0;	
        }
        pinging = false;
        pingCount = 0;
	}else if (rb === SCBD_CHOCOPI_USB_PING){
        if (!connected) {
          clearInterval(poller);		
          poller = null;				
          clearTimeout(watchdog);
          watchdog = null;				
          connected = true;

          setTimeout(init, 200);			
		  sysexBytesRead = 0;		
        }
        pinging = false;
        pingCount = 0;
	}
  }
*/

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



/*
	function actionMotion(){
		stored_data.motion[]=rb*255;
		current_job= actionBranch;	
	}
*/

/*
	function actionModule(){
		rb=inputData[rp++];
		if(rp==inputData.length) return;
		if(rb == SCBD_MOTION)
			stored_data.blocks[port] = motion;		
	}
*/
	
	var current_job = null,		//실행될 함수명을 가지게되는 함수지시자
		rp,
		rb,
		chocoPiVersion = new Array();
	/*var	stored_data = {
		chocoPiVersion : new Array()*/
		/*
		blocks : new Array(function(port){
		},function(port){
		});
		*/
	//};
	var packet_index = 0;
	var status = [packet_index, 0];
	function actionChocopi(){
		rb = inputDataGlobal[rp++];

		if(rb == CPC_VERSION){
			current_job = get_CPCv;
			status.packet_index = 0;
			return;
		}
		return;
	}

	function get_CPCv(){
		if(rp === inputDataGlobal.length) return;
		
		rb = inputDataGlobal[rp++];					//이 부분에서 CPC_VERSION(8) -> CHOCOPI 로 점차 진행하게됨
		chocoPiVersion[status.packet_index++] = rb;
		if(status.packet_index==9){
			//fs
			current_job = actionBranch;
			return;
		}
	}


	function actionBranch(){		//Header Distributor
		var detail = 0,
			port = 0;

		rb = inputDataGlobal[rp++];
		detail = rb & 0xF0;
		port = rb & 0xFF;

		if(rb < 0xE0){
			//current_job=stored_data.blocks[port]();
		}else{
			// SYSTEM BYTE Processing
			if(rb === SCBD_CHOCOPI_USB) {
				//console.log('I am comming processSysexMessage SCBD_CHOCOPI_USB');
				if (!connected) {
				  clearInterval(poller);		//setInterval 함수는 특정 시간마다 해당 함수를 실행
				  poller = null;				//clearInterval 함수는 특정 시간마다 해당 함수를 실행하는 것을 해제시킴
				  clearTimeout(watchdog);
				  watchdog = null;				//감시견을 옆집 개나줘버림
				  connected = true;

				  setTimeout(init, 200);
				  //sysexBytesRead = 0;	
				}
				current_job= actionChocopi;
				pinging = false;
				pingCount = 0;
			}else if (rb === SCBD_CHOCOPI_USB_PING){
				if (!connected) {
				  clearInterval(poller);		
				  poller = null;				
				  clearTimeout(watchdog);
				  watchdog = null;				
				  connected = true;

				  setTimeout(init, 200);			
				  //sysexBytesRead = 0;		
				}
				current_job = actionPing;
				pinging = false;
				pingCount = 0;
			}	
		}	
	}
	//action 에 대해서 분류를 진행함
	var inputDataGlobal = new Int8Array();	

	function processInput(inputData) {
	  //입력 데이터 처리용도의 함수
	  console.log('inputData' + inputData);
		rp=0;
		inputDataGlobal[rp++] = inputData[rp++];	
		console.log('inputDataGlobal is ' + inputDataGlobal[rp]);
		if(current_job==null){
			current_job = actionBranch;
		}

		while(rp<inputData.length){
			current_job();	
		}	
	}


/*

  function processInput(inputData) {
	  //입력 데이터 처리용도의 함수
    for (var i=0; i < inputData.length; i++) {	

		console.log('inputData [' + i + '] = ' + inputData[i]);
      if (parsingSysex) {
		console.log('i =' + i + ' sysexBytesRead = ' + sysexBytesRead);
		if ( sysexBytesRead === 9 && storedInputData[0] === SCBD_CHOCOPI_USB){
		  console.log('I am comming parsingSysex chocopie init starter');				
          parsingSysex = false;		
		 
          processSysexMessage();
		  setVersion(storedInputData[8], storedInputData[9]);		//0xE0, CPC_VERSION, “CHOCOPI”,1,0
		  break;
		  //detail/port + Data ( 10 Byte) = 11 Byte 초과이면 강제로 반복문을 끊어버림   예상값) storedInputData[0] = 0xE0 혹은 0xF0
		  
        } else if (storedInputData[0] === SCBD_CHOCOPI_USB_PING){
		  parsingSysex = false;
          processSysexMessage();
		  break;
        } else if (sysexBytesRead === 17 && (storedInputData[1] === CPC_GET_BLOCK & LOW) && (storedInputData[2] === CPC_GET_BLOCK & HIGH)){
		  parsingSysex = false;				//											     0 1 2 3 4 5 6  7 8 9 10 11 12 13 14 15	(Port)
											// 0xE0, CPC_GET_BLOCK(LOW), CPC_GET_BLOCK(HIGH),8,0,9,0,0,0,12,0,0,0,0, 0, 0, 0, 0, 0	(inputData, storedInputData)
		  for (var i=3; i<19; i++){			
			if(storedInputData[i] != 0){
				connectHW(storedInputData[i], i-3);
			}
		  }
		  break;
        } else if (sysexBytesRead === 3 && storedInputData[0] === (SCBD_CHOCOPI_USB | 0x01)){
			parsingSysex = false;
			connectHW(storedInputData[3] << 7 | storedInputData[2], storedInputData[1]);		//0xE1(0xF1), PORT, BLOCK_TYPE(LOW), BLOCK_TYPE(HIGH)	(inputData, storedInputData)
			
			if(storedInputData[3] << 7 | storedInputData[2] === SCBD_SENSOR){
				sample_functions.sensor_sender(storedInputData[1]);			//SCBD_SENSOR 에 대한 샘플링 레이트
			}else if (storedInputData[3] << 7 | storedInputData[2] === SCBD_MOTION){
				sample_functions.motion_sendor(storedInputData[1]);			//SCBD_MOTION 에 대한 샘플링 레이트
			}
			
			break;
        } else if (sysexBytesRead === 1 && storedInputData[0] === (SCBD_CHOCOPI_USB | 0x02)){
			//0xE2(0xF2), PORT	(inputData, storedInputData)		inputData[0] 번이 0xE2 인 경우, 이어서 포트(1 Byte) 가 전송됨
			parsingSysex = false;
			removeHW(storedInputData[1]);
			break;
        } else if (sysexBytesRead === 1 && storedInputData[0] === (SCBD_CHOCOPI_BLE | 0x03)){
			parsingSysex = false;
			if (storedInputData[1] == 0){ 							//연결해제
				for (var i=8; i < 16; i++){							//0xF3, STATUS (inputData, storedInputData)
					removeHW(i);									//2016.04.30 재패치
				}
				console.log("BLE is disconnected");
			}else if (storedInputData[1] == 1){
				console.log("BLE is connected");
			}
			break;
        }else if (sysexBytesRead === 10 && storedInputData[0] === (SCBD_CHOCOPI_USB | 0x0F)){
			parsingSysex = false;
			console.log('에러발생 ' + storedInputData[1] + storedInputData[2] + '에서 ' + storedInputData[3] + storedInputData[4] + storedInputData[5] + storedInputData[6] + storedInputData[7] + storedInputData[8] + storedInputData[9] + storedInputData[10]);	
			break;	//오류코드 (2 Byte), 참고데이터 (8 Byte)
        }else{
			if (i < 17 && sysexBytesRead < 16)								//
				storedInputData[sysexBytesRead++] = inputData[i];			// 0 부터 도는 for 문에 대해서 port/detail 을 놓치지 않기 위한 조치				
			else															//i는 0부터 시작하지만, 결국적으로 1이 되서야  inputData[i] 를 storedInputData 에 담기 시작할 것임
				continue;													//i가 먼저 끝나면서 데이터를 
        }
		//console.log('storedInputData [' + sysexBytesRead + '] ' + storedInputData[sysexBytesRead]);
	
      } else if (waitForData > 0 && inputData[i] <= 0xCF) {	
        storedInputData[--waitForData] = inputData[i];						// inputData 를 지속적으로 저장하는 과정에서 0xCF (207) 보다 작은값을 판별한다면,
        if (executeMultiByteCommand !== 0 && waitForData === 0) {			// inputData 를 기준으로 판별하면 문제가 생길 가능성이 있음. 
		  if (executeMultiByteCommand === SCBD_SENSOR){						// LOW HIGH 로 나눠서온다면 문제가 없을 것으로 예상
																									// LOW, HIGH (inputData)
              setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);		// HIGH, LOW (storedInputData)
			   	
		  }else if (executeMultiByteCommand === SCBD_TOUCH){
			  
			  if ( waitForData === 0 ){																// 모든 터치센서 전송인 경우
																									// LOW, HIGH (inputData)
				setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);	// HIGH, LOW (storedInputData)
				
			  } else {																					// 들어오는 데이터가 1 Byte 인 경우	
				setDigitalInputs(multiByteChannel, (storedInputData[1] << 7) + TOUCH_REPOTER);			// Button Number (on, off)	(inputData)
			  }																							// 0, Button Number 		(storedInputData)
			  																							// 들어오는 데이터에 대해서 디테일을 확인한 리포터를 보냄
			 
		  }else if (executeMultiByteCommand === SCBD_SWITCH){
			  
			  if ( waitForData === 0 ){																	//포텐시오미터
				if (SWITCH_REPOTER === 0x30){															// LOW, HIGH (inputData)
					setAnalogInput(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);	// HIGH, LOW (storedInputData)
				}else{
					setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);	//조이스틱X, Y는 디지털
				}																
			  }else{																					// 예상값 0x10, 0x20, ....	
				setDigitalInputs(multiByteChannel, (storedInputData[1] << 7) + SWITCH_REPOTER);			// 들어오는 데이터가 1 Byte 인 경우
			  }																							// Button Number (on, off)	(inputData)
																										// 0, Button Number			(storedInputData)
		  }else if (executeMultiByteCommand === SCBD_MOTION){												
																										//1번(LOW, HIGH), 2번(LOW, HIGH), 3번(LOW, HIGH) (inputData)
			  if (waitForData === 0){																	//3번(HIGH, LOW), 2번(HIGH, LOW), 1번(HIGH, LOW) (storedInputData)
				  if (MOTION_REPOTER === 0x10){															//적외선
				   setAnalogInput(multiByteChannel, (storedInputData[0] << 35) + (storedInputData[1] << 28) + (storedInputData[2] << 21) + (storedInputData[3] << 14) + (storedInputData[4] << 7) + storedInputData[5]);
				  }else{																				//가속도, 각가속도
				   setSAnalogInput(multiByteChannel, (storedInputData[0] << 35) + (storedInputData[1] << 28) + (storedInputData[2] << 21) + (storedInputData[3] << 14) + (storedInputData[4] << 7) + storedInputData[5]);
				  }
			  }else if (waitForData === 2){			
				   setAnalogInput(multiByteChannel, (storedInputData[2] << 21) + (storedInputData[3] << 14) + (storedInputData[4] << 7) + storedInputData[5]); 		
				   //  4 Byte ( L, H, LL, HH ) 모든 MOTION_REPOTER 에 대해서 같은 처리가 이루어짐
				   //    0, 0, (HH, LL, H, L)
			  }else if (waitForData === 5){			
				  setAnalogInput(multiByteChannel, storedInputData[5]); 		
			  }			  
		  }																									
		}	
      } else {
        if (inputData[i] >= 0xE0) {							//0xE0 이상의 값을 시스템 메세지용 값으로 분리시킴
			detail = inputData[i];							//예상 데이터) 0xE0, CPC_VERSION, “CHOCOPI”,1,0...
			
        } else {											//SYSTEM_MESSAGE 가 아닌 0xE0 이상의 값은, DC_MOTOR 와 SERVO의 가능성이 있음			
		  detail = inputData[i] & 0xF0;						// 초반 펌웨어 확정과정 이후에, 나머지 디테일/포트합 최대는 0xCF 까지이므로 이 부분을 반드시 타게됨
          multiByteChannel = inputData[i] & 0x0F;			// 1. 문제는 디테일 0~ B 까지 사용하는 것에 대해서 어떤 센서가 사용하는지 확정하기 힘듬
		  port = hwList.search_bypin(multiByteChannel);		// -> hwList.search_bypin 로 조사해서 처리
        }

		if(detail === SCBD_CHOCOPI_USB || detail === SCBD_CHOCOPI_BLE || detail === SCBD_CHOCOPI_USB_PING || detail === (SCBD_CHOCOPI_USB | 0x0F)){
			parsingSysex = true;		//	시스템 메세지 분류 2016.04.23 확인완료
			sysexBytesRead = 0
			storedInputData[sysexBytesRead++] = detail;
			//console.log('storedInputData [' + sysexBytesRead + '] ' + storedInputData[sysexBytesRead]);
			//console.log('detail parsing success and parsingSysex running');
			console.log('ping count ' + pingCount);
		}else if (detail === (SCBD_CHOCOPI_USB | 0x01) || detail === (SCBD_CHOCOPI_BLE | 0x01) || detail === (SCBD_CHOCOPI_USB | 0x02) || detail === (SCBD_CHOCOPI_BLE | 0x02) || detail === (SCBD_CHOCOPI_BLE | 0x03)){
			parsingSysex = true;		//	시스템 메세지 분류 2016.04.23 확인완료
			sysexBytesRead = 0;
			storedInputData[sysexBytesRead++] = detail;
		}else if (port.name === SCBD_SENSOR){
			waitForData = 2;							//전위연산자를 통해서 저장하기 때문에 2 Byte 로 설정		2016.04.23 확인완료
			executeMultiByteCommand = port.name;		//2 Byte = 2 Byte
			SENSOR_REPOTER = detail;
		}else if (port.name === SCBD_TOUCH){
			waitForData = 2;							//1 Byte, 2 Byte = 2 Byte	2016.04.23 확인완료
			executeMultiByteCommand = port.name;
			TOUCH_REPOTER = detail;
		}else if (port.name === SCBD_SWITCH){
			waitForData = 2;							//1 Byte, 2 Byte = 2 Byte	2016.04.23 확인완료			
			executeMultiByteCommand = port.name;		
			SWITCH_REPOTER = detail;
		}else if (port.name === SCBD_MOTION){
			waitForData = 6;							// 6 Byte, 4 Byte, 1 Byte = 6 Byte
			executeMultiByteCommand = port.name;
			MOTION_REPOTER = detail;
		}
      }
    }
  }
*/


	function connectHW (hw, pin) {
		hwList.add(hw, pin);
	}
	//hwList.add 함수에 의거하여, hw 에 새로운 pin 이 지정되도록 이미 코딩되어 있음. (패치 미필요)

	function removeHW(pin){
		hwList.remove(pin);
	}

	function analogRead(pin) {
		var hw = hwList.search_bypin(pin);
		if (!hw){
			var valid = [];
			for (var i = 0; i < 15; i++)
				valid.push(i);
			console.log('ERROR: valid analog pins are ' + valid.join(', '));
			return;
		}else{
			if (pin >= 0 && 15 <= pin) 
			return Math.round((analogInputData[pin] * 100) / 4095);
		}
	}
	//analogRead patched 2016.04.24...	Repatch 2016.04.25
	
	function SanalogRead(pin) {
		var hw = hwList.search_bypin(pin);
		if (!hw){
			var valid = [];
			for (var i = 0; i < 15; i++)
				valid.push(i);
			console.log('ERROR: valid analog pins are ' + valid.join(', '));
			return;
		}else{
			if (pin >= 0 && 15 <= pin) 
			return Math.round((SanalogInputData[pin] * 100) / 4095);
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
	//digitalRead patched 2016.04.21 .. 04.24 recheck
//------------------------------------------------------------------------------Above, Successed Line 

//----------------------------------------------------------------------------------- SYSTEM FUNCTION LINE 
  	ext._getStatus = function() {
			if(!connected) return {status: 1, msg: 'ChocopieBoard disconnected'};
			else return {status: 2, msg: 'ChocopieBoard connected'};	
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
      var inputData = new Int8Array(data);
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

//-------------------------------------------------------------------SAMPLING FUNCTION START

	var low_data = escape_control(SAMPLING_RATE & LOW),
		high_data = escape_control(SAMPLING_RATE & HIGH);
	
	var	check_low = 0,
		check_high = 0;

	var sample_functions = {
		sensor_sender: function(port) {
			var hw = hwList.search_bypin(port),	
				sensor_detail = new Uint8Array([0x40, 0x50, 0x60, 0x00, 0x10, 0x20, 0x30, 0x80]);
			
			var	dnp = new Uint8Array([sensor_detail[0] | hw.pin, sensor_detail[1] | hw.pin, sensor_detail[2] | hw.pin, sensor_detail[3] | hw.pin, sensor_detail[4] | hw_normal.pin, sensor_detail[5] | hw.pin, sensor_detail[6]| hw.pin]);

			for (var i=0;i < dnp.length ; i++){
				check_low = checkSum( dnp[i], low_data );
				check_high = checkSum( dnp[i], high_data );
		
				var sensor_output_low = new Uint8Array([dnp[i], low_data, check_low]),
					sensor_output_high = new Uint8Array([dnp[i], high_data, check_high]);

				device.send(sensor_output_low.buffer);
				device.send(sensor_output_high.buffer);				
			}
		},
		// 리포터 센더 정의 완료. 터치는 센더가 없음.
		motion_sendor: function(port) {
			var hw = hwList.search_bypin(port),	
				sensor_detail = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);	

			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin, sensor_detail[2] | hw_normal.pin, sensor_detail[3] | hw_normal.pin, sensor_detail[4] | hw_normal.pin ]);	
			
			for (var i=0;i < dnp.length -1; i++){
				check_low = checkSum( dnp[i], low_data );	
				check_high = checkSum( dnp[i], high_data );
					
				var motion_output_low = new Uint8Array([dnp[i], low_data, check_low]),
					motion_output_high = new Uint8Array([dnp[i], high_data, check_high]);
					
				device.send(motion_output_low.buffer);
				device.send(motion_output_high.buffer);
			}
			var motion_output = new Uint8Array([dnp[4],  dnp[4]]);
				device.send(motion_output.buffer);
				//포토게이트의 경우 보내는 데이터가 없기 때문에, detail/port 이후에 checkSum 을 예상하여 dnp를 그대로 보낸다.
				//check_low = checkSum( dnp[4], low_data );		//포토게이트류 -> 데이터가 없기 때문에, XOR 과정을 거쳐도 체크섬은 그대로 유지됨
				//check_high = checkSum( dnp[4], high_data );	//데이터를 보내지 않기 때문에 dnp를 그대로전송
		}
	};
	
	//Function added Line -----------------------------------------------------------------------------	

	//reportSensor 에 대하여 검증필요->내용 확인 완료 (light Sensor 또한 Analog) -- Changed By Remoted 2016.04.14
	ext.reportSensor = function(networks, hwIn){
    
	var hw_normal = hwList.search_normal(SCBD_SENSOR),	
		hw_ble = hwList.search_ble(SCBD_SENSOR),
		sensor_detail = new Uint8Array([0x40, 0x50, 0x60, 0x00, 0x10, 0x20, 0x30, 0x80]);

	//for문을 위해서 detail 순서를 온,습,조,아날로그 1,2,3,4 순으로 재조정 -- 2016.05.01 패치	
	
		//온도, 습도, 조도, 아날로그 1, 2, 3, 4, 정지명령 순서 --> 정지명령은 쓸 재간이 없음.
		if (networks === menus[lang]['networks'][0]){
			if(!hw_normal) return;
			else{									
				var	dnp = new Uint8Array([sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin, sensor_detail[2] | hw_normal.pin, sensor_detail[3] | hw_normal.pin, sensor_detail[4] | hw_normal.pin, sensor_detail[5] | hw_normal.pin, sensor_detail[6]| hw_normal.pin]);
				for (var i=0;i < dnp.length ; i++){
					if (hwIn === menus[lang]['hwIn'][i]){
						if (SENSOR_REPOTER === dnp[i] & 0xF0){		//2016.04.25 데이터 읽기 재패치 완료
							return analogRead(hw_normal.pin);
						}
					}
				}
			}
		}else if (networks === menus[lang]['networks'][1]){
			if(!hw_ble) return;
			else{				
				var	dnp = new Uint8Array([sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin, sensor_detail[2] | hw_ble.pin, sensor_detail[3] | hw_ble.pin, sensor_detail[4] | hw_ble.pin, sensor_detail[5] | hw_ble.pin, sensor_detail[6]| hw_ble.pin]);
				for (var i=0;i < dnp.length ; i++){
					if (hwIn === menus[lang]['hwIn'][i]){
						if (SENSOR_REPOTER === dnp[i] & 0xF0){		//2016.04.25 데이터 읽기 재패치 완료
							return analogRead(hw_ble.pin);
						}
					}
				}
			}
		}
	};
	//REPOTER PATCH CLEAR --2016.05.08 간소화 패치 완료

	ext.isTouchButtonPressed = function(networks, touch){
		var hw_normal = hwList.search_normal(SCBD_TOUCH),
			hw_ble = hwList.search_ble(SCBD_TOUCH),
			sensor_detail = new Uint8Array([0x00, 0x10, 0x20]);

		if (networks === menus[lang]['networks'][0]){
			if(!hw_normal) return;
			else{
				if(TOUCH_REPOTER === sensor_detail[2]){	
					var button_num = digitalRead(hw_normal.pin) & 0x0FFF;
						
					for (var i=0; i < 13; i++){
						if ((button_num >> i) & 0x0001 === 1){
							if (touch === menus[lang]['touch'][i])
								return 1;
						}else if ((button_num >> i) & 0x0001 === 0){
							if (touch === menus[lang]['touch'][i])
								return 0;
						}
					}
					/* 모든 터치센서 번호 전송
					setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);  
					HIGH, LOW, Detail/Port (storedInputData)
					  0000 0000 0110
					  0000 0000 0001 &
					*/
				}
			}
		}else if (networks === menus[lang]['networks'][1]){
			if(!hw_ble) return;
			else{
				if(TOUCH_REPOTER === sensor_detail[2]){	
					var button_num = digitalRead(hw_ble.pin) & 0x0FFF;
						
					for (var i=0; i < 13; i++){
						if ((button_num >> i) & 0x0001 === 1){
							if (touch === menus[lang]['touch'][i])
								return 1;
						}else if ((button_num >> i) & 0x0001 === 0){
							if (touch === menus[lang]['touch'][i])
								return 0;
						}
					}
				}
			}
		}	
	};
	//REPOTER PATCH CLEAR	--2016.05.08 간소화 패치 완료

	ext.whenTouchButtonChandged = function(networks, touch, btnStates){
		var hw_normal = hwList.search_normal(SCBD_TOUCH),
			hw_ble = hwList.search_ble(SCBD_TOUCH),
			sensor_detail = new Uint8Array([0x00, 0x10, 0x20]);
	

		if (networks === menus[lang]['networks'][0]){
			if(!hw_normal) return;
			else{
				if (TOUCH_REPOTER === sensor_detail[0] ){
					var	button_num = (digitalRead(hw_normal.pin) & 0x0F00) >> 7;
					if (btnStates === 0){
						//꺼짐
						if (button_num === touch){
							return 0;
						}				
					}
					
					/*  0, Button Number, Detail (on, off)/Port	(storedInputData)
					setDigitalInputs(multiByteChannel, (storedInputData[1] << 7) + storedInputData[2] );
					0000 0000 0000 0000
					0000 0000 1111 0000
						console.log('networks is ' + networks + ' sended'); 
					*/				
				} else if (TOUCH_REPOTER === sensor_detail[1]){
					var	button_num = (digitalRead(hw_normal.pin) & 0x0F00) >> 7;
					if (btnStates === 1){
						//켜짐
						if (button_num === touch){
							return 1;
						}
					}
				}
			}
		}else if (networks === menus[lang]['networks'][1]){
			if(!hw_ble) return;
			else{
				if (TOUCH_REPOTER === sensor_detail[0] ){
					var	button_num = (digitalRead(hw_ble.pin) & 0x0F00) >> 7;
					if (btnStates === 0){
						//꺼짐
						if (button_num === touch){
							return 0;
						}				
					}			
				} else if (TOUCH_REPOTER === sensor_detail[1]){
					var	button_num = (digitalRead(hw_ble.pin) & 0x0F00) >> 7;
					if (btnStates === 1){
						//켜짐
						if (button_num === touch){
							return 1;
						}
					}
				}
			}
		}
	};
	//REPOTER PATCH CLEAR

	ext.whenButton = function(networks, sw, btnStates) {
		//스위치 hat 블록에 대한 함수
		var hw_normal = hwList.search_normal(SCBD_SWITCH),
			hw_ble = hwList.search_ble(SCBD_SWITCH),
			sensor_detail = new Uint8Array([0x00, 0x10]);

		if (networks === menus[lang]['networks'][0]){
			if (!hw_normal) return;
			else{
				if (SWITCH_REPOTER === sensor_detail[0]){
					var button_num = (digitalRead(hw_normal.pin) & 0x0F00) >> 7;
					if (btnStates === 0){
						// 버튼 꺼짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return false;
								}
							}
						}
					}
				}else if (SWITCH_REPOTER === sensor_detail[1]){
					if (btnStates === 1){
						// 버튼 켜짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return true;
								}
							}
						}
					}
				}
					/*  0, Button Number, Detail (on, off)/Port	(storedInputData)
					setDigitalInputs(multiByteChannel, (storedInputData[1] << 7) + storedInputData[2] );
					0000 0000 0000 0000
					0000 0000 1111 0000
					*/
			}
		}else if (networks === menus[lang]['networks'][1]){
			if (!hw_ble) return;
			else{
				if (SWITCH_REPOTER === sensor_detail[0]){
					var button_num = (digitalRead(hw_ble.pin) & 0x0F00) >> 7;
					if (btnStates === 0){
						// 버튼 꺼짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return false;
								}
							}
						}
					}
				}else if (SWITCH_REPOTER === sensor_detail[1]){
					if (btnStates === 1){
						// 버튼 켜짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return true;
								}
							}
						}
					}
				}
			}
		}
		
	};
	//REPOTER PATCH CLEAR

	ext.isSwButtonPressed = function(networks, sw){
		//Boolean Block
		var hw_normal = hwList.search_normal(SCBD_SWITCH),
			hw_ble = hwList.search_ble(SCBD_SWITCH),
			sensor_detail = new Uint8Array([0x00, 0x10]);
		
			if (networks === menus[lang]['networks'][0] ){
				if (!hw_normal) return;
				else{
					if (SWITCH_REPOTER === sensor_detail[0]){
						var button_num = (digitalRead(hw_normal.pin) & 0x0F00) >> 7;
						
						// 버튼 꺼짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return false;
								}
							}
						}
					}else if (SWITCH_REPOTER === sensor_detail[1]){
						// 버튼 켜짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return true;
								}
							}
						}
					}
				}
			}else if (networks === menus[lang]['networks'][1]){
				if (!hw_ble) return;
				else{
					if (SWITCH_REPOTER === sensor_detail[0]){
						var button_num = (digitalRead(hw_ble.pin) & 0x0F00) >> 7;
						
						// 버튼 꺼짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return false;
								}
							}
						}
					}else if (SWITCH_REPOTER === sensor_detail[1]){
						// 버튼 켜짐
						for (var i=1; i < 6; i++){
							if (button_num === i){
								if (sw === menus[lang]['sw'][i-1]){
									return true;
								}
							}
						}
					}
				}
			}
	};
	//2016.05.01 스위치 블록 boolean 패치에 따라서 생겨난 함수
	
	ext.isButtonPressed = function(networks, buttons){
		// 조이스틱X, 조이스틱Y, 포텐시오미터
		var hw_normal = hwList.search_normal(SCBD_SWITCH),
			hw_ble = hwList.search_ble(SCBD_SWITCH),
			sensor_detail = new Uint8Array([0x00, 0x10, 0x30, 0x40, 0x50]);

		
			if (networks === menus[lang]['networks'][0] ){
				if (!hw_normal) return;
				else{
					if (SWITCH_REPOTER === sensor_detail[2]){
						// 포텐시오미터를 REPOTER 값에 따라서 처리함	--> 아날로그로
						if (buttons === menus[lang]['buttons'][2]){
							return analogRead(hw_normal.pin);
						}
						/*
						setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);  
						HIGH, LOW, Detail/Port->multiByteChannel (storedInputData)
						*/
					}else if (SWITCH_REPOTER === sensor_detail[3]){
						// 조이스틱X
						if (buttons === menus[lang]['buttons'][0]){
							return digitalRead(hw_normal.pin);
						}
					}else if (SWITCH_REPOTER === sensor_detail[4]){
						// 조이스틱 Y
						if (buttons === menus[lang]['buttons'][1]){
							return digitalRead(hw_normal.pin);
						}
					}
				}
			}else if (networks === menus[lang]['networks'][1]){
				if (!hw_ble) return;
				else{
					if (SWITCH_REPOTER === sensor_detail[2]){
						// 포텐시오미터를 REPOTER 값에 따라서 처리함	--> 아날로그로
						if (buttons === menus[lang]['buttons'][2]){
							return analogRead(hw_ble.pin);
						}
						/*
						setDigitalInputs(multiByteChannel, (storedInputData[0] << 7) + storedInputData[1]);  
						HIGH, LOW, Detail/Port->multiByteChannel (storedInputData)
						*/
					}else if (SWITCH_REPOTER === sensor_detail[3]){
						// 조이스틱X
						if (buttons === menus[lang]['buttons'][0]){
							return digitalRead(hw_ble.pin);
						}
					}else if (SWITCH_REPOTER === sensor_detail[4]){
						// 조이스틱 Y
						if (buttons === menus[lang]['buttons'][1]){
							return digitalRead(hw_ble.pin);
						}
					}
				}
			}
	};
	//REPOTER PATCH CLEAR

	ext.motionbRead = function(networks, motionb){
		//console.log('motionbRead is run');
		var hw_normal = hwList.search_normal(SCBD_MOTION),
			hw_ble = hwList.search_ble(SCBD_MOTION),
			receive_detail = new Uint8Array([0x10, 0x20, 0x30, 0x80, 0x90, 0xA0, 0xB0, 0xC0]);

		//MOTION_REPOTER
		if (networks === menus[lang]['networks'][0]){
			// 적외선, 가속도, 각가속도, 정지명령(비트 1,2, 3번 순서로 정지 00001110), 포토게이트 수신 순서
			if(!hw_normal) return;
			else{
				if ( motionb === menus[lang]['motionb'][0] || motionb === menus[lang]['motionb'][1] || motionb === menus[lang]['motionb'][2]){	
					if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][0]){			//적외선류
						var state = analogRead(hw_normal.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][1]){
						var state = (analogRead(hw_normal.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][2]){
						var state = (analogRead(hw_normal.pin) & 0xFF0000) >> 28;
						return state;
					}
							
					/* 받아온다. MOTION_REPOTER 에는 detail 이 담겨져있음.
					//3번(HIGH, LOW), 2번(HIGH, LOW), 1번(HIGH, LOW) (storedInputData)
					setAnalogInput(multiByteChannel, (storedInputData[0] << 35) + (storedInputData[1] << 28) + (storedInputData[2] << 21) + (storedInputData[3] << 14) + (storedInputData[4] << 7) + storedInputData[5]);
					*/
				}else if (motionb === menus[lang]['motionb'][3] || motionb === menus[lang]['motionb'][4] || motionb === menus[lang]['motionb'][5]){
					if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][3]){		//가속도류
						var state = SanalogRead(hw_normal.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][4]){
						var state = (SanalogRead(hw_normal.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][5]){
						var state = (SanalogRead(hw_normal.pin) & 0xFF0000) >> 28;
						return state;
					}
				}else if (motionb === menus[lang]['motionb'][6] || motionb === menus[lang]['motionb'][7] || motionb === menus[lang]['motionb'][8]){
					if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][6]){		//각가속도류
						var state = SanalogRead(hw_normal.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][7]){
						var state = (SanalogRead(hw_normal.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][8]){
						var state = (SanalogRead(hw_normal.pin) & 0xFF0000) >> 28;
						return state;
					}
				}else if (motionb === menus[lang]['motionb'][9] || motionb === menus[lang]['motionb'][10]){
					//포토게이트 전체 상태에 대한 처리
					if (MOTION_REPOTER === receive_detail[7] && motionb === menus[lang]['motionb'][9]){
						var photo_ostate = analogRead(hw_normal.pin) & 0x01;	//0x80 인경우 on time 이기 때문에 포토게이트 1이 열린것으로 판별해도됨.
						return photo_ostate;
					}else if (MOTION_REPOTER === receive_detail[7] && motionb === menus[lang]['motionb'][10]){
						var photo_tstate = (analogRead(hw_normal.pin) >> 1) & 0x01;
						return photo_tstate;
					}
					/*else{
						return analogRead(hw.pin);		//receive_detail[3], [4], [5], [6]은 모두다 이것으로 처리가능
					}*/
				}
			}
		}else if (networks === menus[lang]['networks'][1]){
			if(!hw_ble) return;
			else{
				if ( motionb === menus[lang]['motionb'][0] || motionb === menus[lang]['motionb'][1] || motionb === menus[lang]['motionb'][2]){	
					if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][0]){
						var state = analogRead(hw_ble.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][1]){
						var state = (analogRead(hw_ble.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[0] && motionb === menus[lang]['motionb'][2]){
						var state = (analogRead(hw_ble.pin) & 0xFF0000) >> 28;
						return state;
					}
				}else if (motionb === menus[lang]['motionb'][3] || motionb === menus[lang]['motionb'][4] || motionb === menus[lang]['motionb'][5]){
					if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][3]){
						var state = SanalogRead(hw_ble.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][4]){
						var state = (SanalogRead(hw_ble.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[1] && motionb === menus[lang]['motionb'][5]){
						var state = (SanalogRead(hw_ble.pin) & 0xFF0000) >> 28;
						return state;
					}
				}else if (motionb === menus[lang]['motionb'][6] || motionb === menus[lang]['motionb'][7] || motionb === menus[lang]['motionb'][8]){
					if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][6]){
						var state = SanalogRead(hw_ble.pin) & 0x0000FF;
						return state;
					}else if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][7]){
						var state = (SanalogRead(hw_ble.pin) & 0x00FF00) >> 14;
						return state;
					}else if (MOTION_REPOTER === receive_detail[2] && motionb === menus[lang]['motionb'][8]){
						var state = (SanalogRead(hw_ble.pin) & 0xFF0000) >> 28;
						return state;
					}
				}else if (motionb === menus[lang]['motionb'][9] || motionb === menus[lang]['motionb'][10]){
					//포토게이트 전체 상태에 대한 처리
					if (MOTION_REPOTER === receive_detail[7] && motionb === menus[lang]['motionb'][9]){
						var photo_ostate = analogRead(hw_ble.pin) & 0x01;	//0x80 인경우 on time 이기 때문에 포토게이트 1이 열린것으로 판별해도됨.
						return photo_ostate;
					}else if (MOTION_REPOTER === receive_detail[7] && motionb === menus[lang]['motionb'][10]){
						var photo_tstate = (analogRead(hw_ble.pin) >> 1) & 0x01;
						return photo_tstate;
					}
				}
			}
		}
	};
	//REPOTER PATCH SUCCESS -- 2016.05.08 간소화 패치 완료

	ext.photoGateRead = function(networks, photoGate ,gateState){
		//console.log('photoGateRead is run');
		var hw_normal = hwList.search_normal(SCBD_MOTION),
			hw_ble = hwList.search_ble(SCBD_MOTION),
			receive_detail = new Uint8Array([0x10, 0x20, 0x30, 0x80, 0x90, 0xA0, 0xB0, 0xC0]);		//0x80 0x90 0xA0 0xB0

		if (networks === menus[lang]['networks'][0]){
			if (!hw_normal) return;
			else{
				if( photoGate === menus[lang]['photoGate'][0] ){
					if (gateState === menus[lang]['gateState'][1] && MOTION_REPOTER === receive_detail[3]){
						return true;	//포토게이트 1번 열릴때.. 실질적으론 시간이 들어오지만, MOTION_REPOTER 의 디테일값만으로도 막힘 열림 판단가능
					}else if(gateState === menus[lang]['gateState'][0] && MOTION_REPOTER === receive_detail[4]){
						return false;	//포토게이트 1번 막힐때	
					}
				}else if (photoGate === menus[lang]['photoGate'][1]){
					if (gateState === menus[lang]['gateState'][1] && MOTION_REPOTER === receive_detail[5]){
						return true;	//포토게이트 2번 열릴때
					}else if(gateState === menus[lang]['gateState'][0] && MOTION_REPOTER === receive_detail[6]){
						return false;	//포토게이트 2번 막힐때	
					}
				}						
			}
		}else if (networks === menus[lang]['networks'][1]){
			if (!hw_ble) return;
			else{
				if( photoGate === menus[lang]['photoGate'][0] ){
					if (gateState === menus[lang]['gateState'][1] && MOTION_REPOTER === receive_detail[3]){
						return true;	//포토게이트 1번 열릴때.. 실질적으론 시간이 들어오지만, MOTION_REPOTER 의 디테일값만으로도 막힘 열림 판단가능
					}else if(gateState === menus[lang]['gateState'][0] && MOTION_REPOTER === receive_detail[4]){
						return false;	//포토게이트 1번 막힐때	
					}
				}else if (photoGate === menus[lang]['photoGate'][1]){
					if (gateState === menus[lang]['gateState'][1] && MOTION_REPOTER === receive_detail[5]){
						return true;	//포토게이트 2번 열릴때
					}else if(gateState === menus[lang]['gateState'][0] && MOTION_REPOTER === receive_detail[6]){
						return false;	//포토게이트 2번 막힐때	
					}
				}						
			}
		}
	};
	//REPOTER PATCH SUCCESS -- 2016.05.08 간소화 패치 완료

	ext.passLEDrgb = function(networks, ledPosition, r, g, b){
		//console.log('passLEDrgb is run');
		var hw_normal = hwList.search_normal(SCBD_LED), 
			hw_ble = hwList.search_ble(SCBD_LED),
			sensor_detail = new Uint8Array([0x00, 0x80]);

		if (networks === menus[lang]['networks'][0]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin ]);
			if (!hw_normal) return;
			else{
				var led_position = escape_control(dec2hex(ledPosition)),
					red = escape_control(dec2hex(r)),
					green = escape_control(dec2hex(g)),
					blue = escape_control(dec2hex(b));
	
				var merged_data = (led_position << 21) | (red << 14) | (green << 7) | blue,
					check_merged_data = checkSum( dnp[0], merged_data );

				var led_output = new Uint8Array([dnp[0], merged_data, check_merged_data]);		
					device.send(led_output.buffer);
			}
		}else if (networks === menus[lang]['networks'][1]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin ]);
			if (!hw_ble) return;
			else{
				var led_position = escape_control(dec2hex(ledPosition)),
					red = escape_control(dec2hex(r)),
					green = escape_control(dec2hex(g)),
					blue = escape_control(dec2hex(b));
	
				var merged_data = (led_position << 21) | (red << 14) | (green << 7) | blue,
					check_merged_data = checkSum( dnp[0], merged_data );

				var led_output = new Uint8Array([dnp[0], merged_data, check_merged_data]);		
					device.send(led_output.buffer);
			}
		}
	};
	//LED는 수신데이터가 없음.. 오로지 설정뿐

	ext.passBUZEER = function(networks, pitch, playtime){
		
		var hw_normal = hwList.search_normal(SCBD_LED),	//SCBD_LED 
			hw_ble = hwList.search_ble(SCBD_LED),
			sensor_detail = new Uint8Array([0x00, 0x80]);

		if (networks === menus[lang]['networks'][0]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin ]);
			if (!hw_normal) return;
			else{
				var pitch_data = escape_control(dec2hex(pitch)),
					playtime_data = escape_control(dec2hex(playtime)),
					merged_data = (pitch_data << 28) |  playtime_data;
				
				var check_merged_data  = checkSum( dnp[1], merged_data );
				
				var buzzer_output = new Uint8Array([dnp[1], merged_data, check_merged_data]);	
				//낭비되는 데이터 공간의 최대한 절약을 위해서 Uint8Array 로 보냄
				device.send(buzzer_output.buffer);
			}
		}else if (networks === menus[lang]['networks'][1]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin ]);
			if (!hw_ble) return;
			else{
				var pitch_data = escape_control(dec2hex(pitch)),
					playtime_data = escape_control(dec2hex(playtime)),
					merged_data = (pitch_data << 28) |  playtime_data;
				
				var check_merged_data  = checkSum( dnp[1], merged_data );
				
				var buzzer_output = new Uint8Array([dnp[1], merged_data, check_merged_data]);	
				//낭비되는 데이터 공간의 최대한 절약을 위해서 Uint8Array 로 보냄
				device.send(buzzer_output.buffer);
			}
		}
	};

	ext.passSteppingAD = function(networks, steppingMotor, speed, stepDirection){
		//console.log('passSteppingAD is run');
		var hw_normal = hwList.search_normal(SCBD_STEPPER),
			hw_ble = hwList.search_ble(SCBD_STEPPER),
			sensor_detail = new Uint8Array([0x00, 0x10]);

		var speed_data = speed,
			motor_data = dec2hex(steppingMotor);

		if (networks === menus[lang]['networks'][0]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin ]);
			if (!hw_normal) return;
			else{
				if (stepDirection === menus[lang]['stepDirection'][0]){
				//시계방향
					if(speed_data < 0){
						speed_data = speed_data * -1;
					}else{
						if (speed_data > 1023)
							speed_data = 1023;		//데이터 보정
					}
				}else if (stepDirection === menus[lang]['stepDirection'][1]){
				//반시계방향
					if (speed_data > 0){
						speed_data = speed_data * -1;
					}else{
						if(speed_data < -1023){
							speed_data = -1023;
						}
					}
				}
				
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH),
					merged_data = (motor_data << 14) | (speed_data_low << 7) | speed_data_high;

				var check_merged_data = checkSum( dnp[0], merged_data ),
					steppingAD_output = new Int16Array([dnp[0], merged_data, check_merged_data]);	//signed 로 전송

				device.send(steppingAD_output.buffer);
			}
		}else if (networks === menus[lang]['networks'][1]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin ]);
			if (!hw_ble) return;
			else{
				if (stepDirection === menus[lang]['stepDirection'][0]){
				//시계방향
					if(speed_data < 0){
						speed_data = speed_data * -1;
					}else{
						if (speed_data > 1023)
							speed_data = 1023;		//데이터 보정
					}
				}else if (stepDirection === menus[lang]['stepDirection'][1]){
				//반시계방향
					if (speed_data > 0){
						speed_data = speed_data * -1;
					}else{
						if(speed_data < -1023){
							speed_data = -1023;
						}
					}
				}
				
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH),
					merged_data = (motor_data << 14) | (speed_data_low << 7) | speed_data_high;

				var check_merged_data = checkSum( dnp[0], merged_data ),
					steppingAD_output = new Int16Array([dnp[0], merged_data, check_merged_data]);	//signed 로 전송

				device.send(steppingAD_output.buffer);
			}
		}
	};

	ext.passSteppingADA = function(networks, steppingMotor, speed, stepDirection, rotation_amount){
		//console.log('passSteppingADA is run');
		var hw_normal = hwList.search_normal(SCBD_STEPPER),
			hw_ble = hwList.search_ble(SCBD_STEPPER),
			sensor_detail = new Uint8Array([0x00, 0x10]);

		var speed_data = speed,
			motor_data = dec2hex(steppingMotor),
			rotation_data = rotation_amount;

		if (networks === menus[lang]['networks'][0]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin ]);
			if (!hw_normal) return;
			else{
				if (stepDirection === menus[lang]['stepDirection'][0]){
				//시계방향
					if(speed_data < 0){
						speed_data = speed_data * -1;
					}else{
						if (speed_data > 1023)
							speed_data = 1023;		//데이터 보정
					}
				}else if (stepDirection === menus[lang]['stepDirection'][1]){
				//반시계방향
					if (speed_data > 0){
						speed_data = speed_data * -1;
					}else{
						if(speed_data < -1023){
							speed_data = -1023;
						}
					}
				}
			
				if(rotation_amount > 65535){
					rotation_data = 65535;
				}else if(rotation_amount < -65535){
					rotation_data = -65535;
				}
	
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH);

				var mod_rotation_data = escape_control(dec2hex( Math.floor(rotation_data / 512) )),
					merged_data = (motor_data << 42) | (speed_data_low << 35) | (speed_data_high << 28) | mod_rotation_data;
				console.log('rotation data is ' + mod_rotation_data);

				var check_merged_data = checkSum( dnp[1], merged_data ),
					steppingAD_output = new Int32Array([dnp[1], merged_data, check_merged_data]);	//singed 4 Byte

				device.send(steppingAD_output.buffer);
			}
		}else if (networks === menus[lang]['networks'][1]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin ]);
			if (!hw_ble) return;
			else{
				if (stepDirection === menus[lang]['stepDirection'][0]){
				//시계방향
					if(speed_data < 0){
						speed_data = speed_data * -1;
					}else{
						if (speed_data > 1023)
							speed_data = 1023;		//데이터 보정
					}
				}else if (stepDirection === menus[lang]['stepDirection'][1]){
				//반시계방향
					if (speed_data > 0){
						speed_data = speed_data * -1;
					}else{
						if(speed_data < -1023){
							speed_data = -1023;
						}
					}
				}
			
				if(rotation_amount > 65535){
					rotation_data = 65535;
				}else if(rotation_amount < -65535){
					rotation_data = -65535;
				}
	
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH);

				var mod_rotation_data = escape_control(dec2hex( Math.floor(rotation_data / 512) )),
					merged_data = (motor_data << 42) | (speed_data_low << 35) | (speed_data_high << 28) | mod_rotation_data;
				console.log('rotation data is ' + mod_rotation_data);

				var check_merged_data = checkSum( dnp[1], merged_data ),
					steppingAD_output = new Int32Array([dnp[1], merged_data, check_merged_data]);	//singed 4 Byte

				device.send(steppingAD_output.buffer);
			}
		}
	};

	ext.passDCAD = function(networks, dcMotor, speed, stepDirection){
		//console.log('passDCAD is run');
		var hw_normal = hwList.search_normal(SCBD_DC_MOTOR),
			hw_ble = hwList.search_ble(SCBD_DC_MOTOR),
			sensor_detail = new Uint8Array([0x10, 0x20, 0x30]);

		var speed_data = speed,
			direction_data = 0;
		
		if (networks === menus[lang]['networks'][0]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_normal.pin, sensor_detail[1] | hw_normal.pin, sensor_detail[2] | hw_normal.pin]);
			if (!hw_normal) return;
			else{
				if(speed > 1024){
					speed_data = 1024;
				}else if (speed < 0){
					speed_data = 0;
				}

				if (stepDirection === menus[lang]['stepDirection'][0])
					direction_data = 1;	//시계
				else
					direction_data = 0;	//반시계
					
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH),
					merged_data = (speed_data_low << 14) | (speed_data_high << 7) | dec2hex(direction_data);

				for (var i=0; i < 3; i++ ){
					if (dcMotor === menus[lang]['dcMotor'][i]){				
					var check_merged_data = checkSum( dnp[i], merged_data ),
						DCAD_output = new Uint8Array([dnp[i], merged_data, check_merged_data]);	

						device.send(DCAD_output.buffer);
					}
				}
			}
		}else if (networks === menus[lang]['networks'][1]){
			var	dnp = new Uint8Array([ sensor_detail[0] | hw_ble.pin, sensor_detail[1] | hw_ble.pin, sensor_detail[2] | hw_ble.pin]);
			if (!hw_ble) return;
			else{
				if(speed > 1024){
					speed_data = 1024;
				}else if (speed < 0){
					speed_data = 0;
				}

				if (stepDirection === menus[lang]['stepDirection'][0])
					direction_data = 1;	//시계
				else
					direction_data = 0;	//반시계
					
				var	speed_data_low = escape_control(dec2hex(speed_data) & LOW),
					speed_data_high = escape_control(dec2hex(speed_data) & HIGH),
					merged_data = (speed_data_low << 14) | (speed_data_high << 7) | dec2hex(direction_data);

				for (var i=0; i < 3; i++ ){
					if (dcMotor === menus[lang]['dcMotor'][i]){				
					var check_merged_data = checkSum( dnp[i], merged_data ),
						DCAD_output = new Uint8Array([dnp[i], merged_data, check_merged_data]);	

						device.send(DCAD_output.buffer);
					}
				}
			}
		}
		
	};

	ext.rotateServo = function(networks, servosport, servos, degree) {
		//console.log('rotateServo is run');
		var hw = hwList.search(SCBD_SERVO),
			sensor_detail = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
		
		var servo_hooker = new Uint8Array([hwList.search_bypin(0), hwList.search_bypin(1), hwList.search_bypin(2), hwList.search_bypin(3),
										hwList.search_bypin(4), hwList.search_bypin(5), hwList.search_bypin(6), hwList.search_bypin(7),
										hwList.search_bypin(8), hwList.search_bypin(9), hwList.search_bypin(10), hwList.search_bypin(11),
										hwList.search_bypin(12), hwList.search_bypin(13), hwList.search_bypin(14),hwList.search_bypin(15)]);

		if (!hw) return;
		else{
			var mod_degree = 0;
			if (degree > 180){
				mod_degree = 180;
			}else if(degree < 0){
				mod_degree = 0;
			}

			if (networks === menus[lang]['networks'][0] ){
				for (var i=0; i < 8; i++){		//네트워크가 일반인경우 0번부터 7번까지 담당함.
					if (servo_hooker[i].name === SCBD_SERVO){
						var dnp = new Uint8Array([ sensor_detail[0] | servo_hooker[i].pin, sensor_detail[1] | servo_hooker[i].pin, sensor_detail[2] | servo_hooker[i].pin, sensor_detail[3] | servo_hooker[i].pin ]);
						
						var servo_deg_low = escape_control(dec2hex(mod_degree) & LOW),
							servo_deg_high = escape_control(dec2hex(mod_degree) & HIGH);
						if (servosport === menus[lang]['servosport'][i]){
							if (servos === menus[lang]['servos'][0]){
							var check_deg_low = checkSum( dnp[0], servo_deg_low ),
								check_deg_high = checkSum( dnp[0], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[0], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[0], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if(servos === menus[lang]['servos'][1]){
							var check_deg_low = checkSum( dnp[1], servo_deg_low ),
								check_deg_high = checkSum( dnp[1], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[1], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[1], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if (servos === menus[lang]['servos'][2]){
							var check_deg_low = checkSum( dnp[2], servo_deg_low ),
								check_deg_high = checkSum( dnp[2], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[2], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[2], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if (servos === menus[lang]['servos'][3]){
							var check_deg_low = checkSum( dnp[3], servo_deg_low ),
								check_deg_high = checkSum( dnp[3], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[3], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[3], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}
						}
					}
				}	
			}else if(networks === menus[lang]['networks'][1]){
				for (var i=8; i < 16; i++){				//네트워크가 무선인경우 8번부터 15번까지 담당함
					if (servo_hooker[i].name === SCBD_SERVO){
						var dnp = new Uint8Array([ sensor_detail[0] | servo_hooker[i].pin, sensor_detail[1] | servo_hooker[i].pin, sensor_detail[2] | servo_hooker[i].pin, sensor_detail[3] | servo_hooker[i].pin ]);
						
						var servo_deg_low = escape_control(dec2hex(mod_degree) & LOW),
							servo_deg_high = escape_control(dec2hex(mod_degree) & HIGH);
						if (servosport === menus[lang]['servosport'][i]){
							if (servos === menus[lang]['servos'][0]){
							var check_deg_low = checkSum( dnp[0], servo_deg_low ),
								check_deg_high = checkSum( dnp[0], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[0], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[0], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if(servos === menus[lang]['servos'][1]){
							var check_deg_low = checkSum( dnp[1], servo_deg_low ),
								check_deg_high = checkSum( dnp[1], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[1], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[1], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if (servos === menus[lang]['servos'][2]){
							var check_deg_low = checkSum( dnp[2], servo_deg_low ),
								check_deg_high = checkSum( dnp[2], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[2], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[2], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}else if (servos === menus[lang]['servos'][3]){
							var check_deg_low = checkSum( dnp[3], servo_deg_low ),
								check_deg_high = checkSum( dnp[3], servo_deg_high ),
								servo_output_low = new Uint8Array([dnp[3], servo_deg_low, check_deg_low]),
								servo_output_high = new Uint8Array([dnp[3], servo_deg_high, check_deg_high]);
							
							device.send(servo_output_low.buffer);
							device.send(servo_output_high.buffer);
							}
						}
					}
				}
			}
		}
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
      ['r', 'read from %m.networks to %m.hwIn', 'reportSensor', 'normal','temperature sensor'],		//light, temperature, humidity and analog sensor combined (normal, remote)
      ['-'],																						//function_name: reportSensor
	  ['r', '%m.networks touch sensor %m.touch is pressed?', 'isTouchButtonPressed', 'normal', 1],		//Touch Sensor is boolean block (normal, remote)
	  ['h', 'when %m.networks touch sensor %m.touch is %m.btnStates', 'whenTouchButtonChandged', 'normal', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
      ['-'],
      ['h', 'when %m.networks sw block %m.sw to %m.btnStates', 'whenButton', 'normal', 'Button 1', 0],	//sw block (button 1, .. )		function_name :
      [' ', '%m.networks sw block %m.buttons of value', 'isButtonPressed', 'normal','Joystick X'],			//buttons ( button 1, 2, 3, 4)	whenButton
	  ['b', '%m.networks sw block %m.sw of value', 'isSwButtonPressed', 'normal','Button 1'],					//Joystick and Potencyometer	isButtonPressed
	  ['-'],																									
	  ['r', '%m.networks motion-block %m.motionb of value', 'motionbRead', 'normal','infrared 1'],								//Motion block is infrared, acceler and so on
	  ['h', 'when %m.networks motion-block %m.photoGate is %m.gateState', 'photoGateRead', 'normal', 'photoGate 1', 'blocked'],	//function_name : motionbRead	photoGateRead	
	  ['-'],
	  [' ', '%m.networks LED LOCATION %n RED %n GREEN %n BLUE %n', 'passLEDrgb', 'normal', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.networks BUZZER PITCH %n DURATION %n seconds', 'passBUZEER', 'normal', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection', 'passSteppingAD', 'normal', 1, 0, 'clockwise'],
	  [' ', '%m.networks %m.steppingMotor Stepping Motor Accel %n Direction %m.stepDirection Angle %n', 'passSteppingADA', 'normal', 1, 0, 'clockwise', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
	  ['-'],
	  [' ', '%m.networks %m.dcMotor DC Motor Accel %n Direction %m.stepDirection', 'passDCAD', 'normal', 1, 0, 'clockwise'],
	  ['-'],
	  [' ', '%m.networks %m.servosport %m.servos to %n degrees', 'rotateServo', 'normal', 'Port 1', 'Servo 1', 180]
    ],
    ko: [																						
      ['r', '%m.networks 센서블록 %m.hwIn 의 값', 'reportSensor', '일반', '온도'],										// 조도, 온도, 습도, 아날로그 통합함수 (일반, 무선)
      ['-'],																											// function_name = reportSensor
	  ['r', '%m.networks 터치센서 %m.touch 의 값', 'isTouchButtonPressed', '일반', 1],									//Touch Sensor is boolean block	-- normal and remote					
	  ['h', '%m.networks 터치센서 %m.touch 가 %m.btnStates 가 될 때', 'whenTouchButtonChandged', '일반', 1, 0],		//function_name : isTouchButtonPressed	whenTouchButtonChandged
	  ['-'],																											//function_name : isTouchButtonPressed 
      ['h', '%m.networks 스위치블록 %m.sw 이 %m.btnStates 될 때', 'whenButton', '일반', '버튼 1', 0],				//sw block (button 1, .. )
      [' ', '%m.networks 스위치블록 %m.buttons 의 값', 'isButtonPressed', '일반','조이스틱 X'],							//buttons ( button 1, 2, 3, 4, J)				
	  ['b', '%m.networks 스위치블록 %m.sw 의 값', 'isSwButtonPressed', '일반','버튼 1'],							//Joystick and Potencyometer function is combined.
	  ['-'],																										//function_name :  isButtonPressed	whenButton
	  ['r', '%m.networks 모션블록 %m.motionb 의 값', 'motionbRead', '일반','적외선 감지 1'],								//Motion block is infrared, acceler and so on
	  ['h', '%m.networks 모션블록 %m.photoGate 가 %m.gateState', 'photoGateRead', '일반', '포토게이트 1', '막힐때'],	//function_name : motionbRead	photoGateRead	
	  ['-'],																	//LED RGB definition
	  [' ', '%m.networks LED블록 위치 %n 빨강 %n 녹색 %n 파랑 %n', 'passLEDrgb', '일반', 0, 0, 0, 0],		//LED block is defined.	function_name : passLEDrgb
	  [' ', '%m.networks 버저 음높이 %n 연주시간 %n 밀리초', 'passBUZEER', '일반', 0, 1000],			//Buzzer block is defined. function_name : passBUZEER
	  ['-'],
	  [' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection', 'passSteppingAD', '일반', 1, 0, '시계'],
	  [' ', '%m.networks %m.steppingMotor 번 스테핑모터 속도 %n 방향 %m.stepDirection 회전량 %n', 'passSteppingADA', '일반', 1, 0, '시계', 0],
		//Stepping Motor is defined.
		//function_name : passSteppingAD	passSteppingADA
	  ['-'],																											//DC motor is defined
	  [' ', '%m.networks %m.dcMotor 번 DC모터 속도 %n 방향 %m.stepDirection', 'passDCAD', '일반', 1, 0, '시계'],		//function_name : passDCDA passRDCDA	
	  ['-'],
	  [' ', '%m.networks %m.servosport %m.servos 각도 %n', 'rotateServo', '일반', '포트 1', '서보모터 1', 180]	//ServoMotor, Multiple Servo and Remote Servo is defined.
    ]
  };

  var menus = {
    en: {
		networks: ['normal', 'remote'],
		buttons: ['Joystick X', 'Joystick Y', 'Potencyometer'],
		sw: ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button J'],
		//Buttons, Joystick sensor and potencyomer sensor listing

		btnStates: [0, 1],
		//0 : pressed  1: released

		hwIn: [ 'temperature sensor', 'humidity sensor', 'light sensor', 'Analog 1', 'Analog 2', 'Analog 3', 'Analog 4'],						
		//Analog Sensor and Analog Sensor for 1, 2, 3 and 4 added

		outputs: ['on', 'off'],
		ops: ['>', '=', '<'],
		servos: ['Servo 1', 'Servo 2', 'Servo 3', 'Servo 4'],

		servosport: [ 'Port 1', 'Port 2', 'Port 3', 'Port 4', 'Port 5', 'Port 6', 'Port 7', 'Port 8'],

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor and Remoted touch sensor listing
	
		motionb: ['infrared 1', 'infrared 2', 'infrared 3', 
			'acceler X', 'acceler Y', 'acceler Z', 
			'pacceler U', 'pacceler V', 'pacceler W', 
			'photoGate 1', 'photoGate 2'],
		photoGate: ['photoGate 1', 'photoGate 2'],
		gateState: ['blocked','opened'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: [1, 2],
		stepDirection:['clockwise','declockwise'],
		//steppingMotor is defined.

		dcMotor: [1, 2, 3]
		//dcMotor is defined.

    },
    ko: {
		networks: ['일반', '무선'],
		buttons: ['조이스틱 X', '조이스틱 Y', '포텐시오미터'],
		sw : ['버튼 1', '버튼 2', '버튼 3', '버튼 4', '버튼 J'],
		//Joystick sensor and potencyomer sensor listing

		btnStates: [0, 1],
		// 0 : 눌림  1 : 떼짐

		hwIn: ['온도', '습도','조도','아날로그 1', '아날로그 2', '아날로그 3', '아날로그 4'],
		// light, temperature and humidity and Analog Sensor for 1, 2, 3 and 4 is defined.

		outputs: ['켜기', '끄기'],
		ops: ['>', '=', '<'],
		servos: ['서보모터 1', '서보모터 2', '서보모터 3', '서보모터 4'],
		servosport: [ '포트 1', '포트 2', '포트 3', '포트 4', '포트 5', '포트 6', '포트 7', '포트 8'],

		touch: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		// Touch sensor listing

		motionb: ['적외선 감지 1', '적외선 감지  2', '적외선 감지  3', 
			'가속도 X', '가속도 Y', '가속도 Z', 
			'각가속도 U', '각가속도 V', '각가속도 W', 
			'포토게이트 1', '포토게이트 2'],
		photoGate: ['포토게이트 1', '포토게이트 2'],
		gateState: ['막힐때','열릴때'],
		//infrared sensor and acceler and pacceler sensor listing
		//photogate and gate status is defined.

		steppingMotor: [1, 2],
		stepDirection:['시계','반시계'],
		//steppingMotor is defined.

		dcMotor: [1, 2, 3]
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