// ==UserScript==
// @name         디시 글 번호/URL로 해당 글 위치한 페이지로 이동
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  입력한 글 번호 위치를 계산하여 이동한 후, 삭제글 오차를 감지해 목표 글이 존재하는 정확한 페이지로 정밀 보정 이동합니다. | 현재 50글 기준, 1페이지에서만 작동
// @author       JKAKK
// @match        https://gall.dcinside.com/board/lists/*
// @match        https://gall.dcinside.com/mgallery/board/lists/*
// @match        https://gall.dcinside.com/mini/board/lists/*
// @updateURL    https://raw.githubusercontent.com/junsarakill/jk-dcinside-page-finder/main/JKDPF.user.js
// @downloadURL  https://raw.githubusercontent.com/junsarakill/jk-dcinside-page-finder/main/JKDPF.user.js
// @grant        none
// ==/UserScript==

(function ()
{
    'use strict';

    class JKDCPageFinder 
    {
        constructor() 
        {
            this.init();
        }

        // 페이지 당 글 갯수
        postsPerPage = 50;

        // 디버그 모드 | 로그 작동
        isDebug = false;

        /**
         * #### 기능 시작 부분
         * @returns {void} - 
         */
        init()
        {
            window.addEventListener('load', () => {
                this.createJumpUI();
                this.autoCalibratePosition();
            });
        }

        /**
         * #### 목록에서 주어진 것 중 일반 글의 글 번호 배열 추출
         * @param {Document} docContext - 글 목록
         * @returns {Array} - 일반 글 번호 배열
         */
        extractPostNumbersFromDoc(docContext)
        {
            // 게시글 정보
            const rows = docContext.querySelectorAll('.gall_list .ub-content');
            // 반환할 글 번호 배열
            const numbers = [];

            for (const row of rows)
            {
                // 1. 첫 페이지라면 존재하는 공지 글을 무시 처리 | 공지 태그, 아이콘, 텍스트로 분류
                if (row.classList.contains('notice') || row.classList.contains('issue-wrap'))
                    continue;

                const noticeIcon = row.querySelector('.icon_notice, .icon_survey, .icon_ad');
                if (noticeIcon)
                    continue;

                const headText = row.querySelector('.gall_subject, .head_text');
                if (headText && headText.innerText.includes('공지'))
                    continue;

                // 2. 공지가 아닌 일반글 중 가장 최신 글의 번호 구하기
                const numTd = row.querySelector('.gall_num');
                if (numTd)
                {
                    const text = numTd.innerText.trim();
                    if (/^\d+$/.test(text))
                    {
                        const parsedNo = parseInt(text, 10);
                        if (!isNaN(parsedNo))
                            numbers.push(parsedNo);
                    }
                }
            }
            return numbers;
        }
        
        /**
         * #### 현재 페이지 일반 글 번호 배열 가져오기
         * @returns {Array<number>} - 현재 페이지 일반 글 번호 배열
         */
        getCurPagePostNums()
        {
            return this.extractPostNumbersFromDoc(document);
        }

        /**
         * #### 최신 일반글 번호 가져오기
         * @description 현재 1페이지가 아니면 비동기로 불러와서 조회 기능 지원
         * @returns {number} - 가장 최신 글의 번호
         */
        async getLatestPostNo()
        {
            const urlParams = new URLSearchParams(window.location.search);
            const curPage = parseInt(urlParams.get('page') || '1', 10);

            // 이미 1페이지에 있다면 현재 DOM에서 바로 추출
            if (curPage === 1)
            {
                const numAry = this.getCurPagePostNums();
                return numAry.length > 0 ? numAry[0] : null;
            }

            // 1페이지가 아니라면 백그라운드에서 1페이지를 fetch하여 최신글 확인
            try
            {
                const page1Url = new URL(window.location.href);
                page1Url.searchParams.set('page', '1');
                page1Url.searchParams.delete('target_no');
                page1Url.searchParams.delete('calibrated');

                const response = await fetch(page1Url.toString());
                const html = await response.text();

                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const numAry = this.extractPostNumbersFromDoc(doc);
                return numAry.length > 0 ? numAry[0] : null;
            }
            catch (error)
            {
                console.error('1페이지 최신글 조회 실패:', error);
                const numAry = this.getCurPagePostNums();
                return numAry.length > 0 ? numAry[0] : null;
            }
        }

        /**
         * #### 입력 값에서 글 번호만 추출
         * @description 입력창에서 글 url 등이 들어올때 추출
         * @param {String} inputStr - 입력값
         * @returns {number} - 글 번호
         */
        extractPostNo(inputStr)
        {
            if (!inputStr)
                return null;

            const trimmed = inputStr.trim();

            if (/^\d+$/.test(trimmed))
                return parseInt(trimmed, 10);

            const noParamMatch = trimmed.match(/[?&]no=(\d+)/);
            if (noParamMatch)
                return parseInt(noParamMatch[1], 10);

            const lastNumMatch = trimmed.match(/(\d+)(?:\/?|\?.*)$/);
            if (lastNumMatch)
                return parseInt(lastNumMatch[1], 10);

            return null;
        }

        /**
         * #### 페이지 이동 후 정밀 보정
         * @description 삭제, 숨김 처리 등으로 없어진 글로 인한 페이지 오차를 보정
         * @returns {void} - 
         */
        autoCalibratePosition()
        {
            const curURLParams = new URLSearchParams(window.location.search);

            // 찾아낼 글 번호
            const targetNo = parseInt(curURLParams.get('target_no'), 10);
            const curPage = parseInt(curURLParams.get('page') || '1', 10);
            const isCalibrated = curURLParams.get('calibrated') === '1';

            if (isNaN(targetNo))
            {
                this.log('자동 보정 스킵: target_no가 없음');
                return;
            }

            const postNumbers = this.getCurPagePostNums();
            if (postNumbers.length === 0)
            {
                this.log('자동 보정 스킵: 현재 페이지 글 목록을 찾을 수 없음');
                return;
            }

            // 현재 페이지의 가장 큰 글 번호
            const maxNo = postNumbers[0]; 
            // 현재 페이지의 가장 작은 글 번호
            const minNo = postNumbers[postNumbers.length - 1]; 

            this.log(`중간 체크 목표 글(${targetNo})이 현재 페이지 범위(${minNo} ~ ${maxNo})`);

            // 목표 글 번호가 현재 페이지 범위 내에 있다면 보정 완료
            if (targetNo >= minNo && targetNo <= maxNo)
            {
                this.log(`🎉 목표 글(${targetNo})이 현재 페이지 범위(${minNo} ~ ${maxNo}) 내에 존재합니다. 보정 작업이 성공적으로 완료되었습니다.`);

                // 작동 플로우 종료시점
                this.clearSessionState();
                this.cleanUpURLParams();
                return;
            }

            // MARK: 보정 데이터 불러오기
            const { prevPage, prevMidNo, densityRatio } = this.getSessionState();

            // 🛡️ [방어 분기] 밀도 계수나 필수 세션 데이터가 NaN으로 오염된 경우 무한 루프 방지
            if (isNaN(densityRatio))
            {
                // 세션 데이터가 손상되었으므로 초기화 후 기본값으로 진행 또는 탈출
                this.log('⚠️ 경고: 세션 밀도 계수가 NaN으로 오염되어 초기화합니다.');
                this.clearSessionState();
            }

            const curMidNo = Math.floor((maxNo + minNo) / 2);

            let newDensityRatio = isNaN(densityRatio) ? 1.0 : densityRatio;

            if (!isNaN(prevPage) && !isNaN(prevMidNo))
            {
                // 🛡️ 만약 이전 페이지 기록은 존재하는데 둘 중 하나라도 NaN이면 데이터 오염 상태이므로 중단
                if (isNaN(prevPage) || isNaN(prevMidNo))
                {
                    this.log('🛑 오류: 세션 기록이 손상되었습니다(NaN 감지). 무한 루프 방지를 위해 보정을 중단합니다.');
                    this.clearSessionState();
                    return;
                }

                const actualPageDiff = Math.abs(curPage - prevPage);
                const actualNoDiff = Math.abs(curMidNo - prevMidNo);

                if (actualPageDiff > 0 && actualNoDiff > 0)
                {
                    const expectedNoDiff = actualPageDiff * this.postsPerPage;
                    const measuredRatio = actualNoDiff / expectedNoDiff;
                    newDensityRatio = Math.max(0.2, Math.min(2.0, measuredRatio));

                    // 📊 학습 데이터 변화량 및 측정값 상세 로그
                    this.log
                    (
                        `📊 밀도 분석: ` +
                        `이전 페이지(${prevPage} -> 현 ${curPage}, ΔPage: ${actualPageDiff}) | ` +
                        `중간번호 변화(${prevMidNo} -> 현 ${curMidNo}, ΔNo: ${actualNoDiff}) | ` +
                        `예상 번호변화(${expectedNoDiff}) | ` +
                        `측정 비율(${measuredRatio.toFixed(3)}) | ` +
                        `적용된 밀도 계수: ${densityRatio.toFixed(3)} ➔ ${newDensityRatio.toFixed(3)}`
                    );
                }
                else
                {
                    this.log(`⚠️ 밀도 분석 스킵: 페이지 변화량 또는 번호 변화량이 0입니다. (ΔPage: ${actualPageDiff}, ΔNo: ${actualNoDiff})`);
                }
            }
            else
            {
                this.log(`💡 첫 번째 점프이므로 학습된 밀도 계수(${newDensityRatio.toFixed(3)})를 기본값으로 사용합니다.`);
            }

            // 현재 상태 저장
            this.setSessionState(curPage, curMidNo, newDensityRatio);

            // MARK: 보정 작업
            // 목표 페이지와의 차이량
            let rawDiffPage = 0;
            // 방향 판별 (1: 과거로 이동/페이지 증가, -1: 최신으로 이동/페이지 감소)
            let direction = 0; 

            // 목표 번호가 현재 페이지 최소 번호보다 작음 -> 더 과거 페이지(page 증가)로 이동
            if (targetNo < minNo)
            {
                rawDiffPage = minNo - targetNo;
                direction = 1;
            }
            // 목표 번호가 현재 페이지 최대 번호보다 큼 -> 더 최신 페이지(page 감소)로 이동
            else if (targetNo > maxNo)
            {
                rawDiffPage = targetNo - maxNo;
                direction = -1;
            }

            if (direction !== 0)
            {
                const baseEstimatedPages = Math.floor(rawDiffPage / this.postsPerPage);
                const adjustedPages = Math.round(baseEstimatedPages / newDensityRatio);
                const diffPage = Math.max(1, adjustedPages);
                
                // 방향에 맞춰 페이지 계산 (과거로 갈 땐 +, 최신으로 갈 땐 -)
                const calibratedPage = Math.max(1, curPage + (diffPage * direction));
                // 무한 리다이렉트 방지 및 목적지 페이지가 동일할 경우 차이 1 부여
                const finalPage = (calibratedPage === curPage) ? curPage + direction : calibratedPage;

                this.log(`🔄 오차 감지: 목표 글(${targetNo})이 현재 범위 외에 있어 ${curPage}에서 ${finalPage}페이지로 정밀 보정 이동합니다.`);
                
                const targetURL = new URL(window.location.href);
                targetURL.searchParams.set('page', finalPage.toString());
                targetURL.searchParams.set('target_no', targetNo.toString());
                
                window.location.href = targetURL.toString();
            }
        }

        /**
         * #### 이동 작업 종료 후 URL에 남은 스크립트 전용 파라미터 정리
         * @returns {void} - 
         */
        cleanUpURLParams()
        {
            const cleanURL = new URL(window.location.href);
            cleanURL.searchParams.delete('target_no');
            cleanURL.searchParams.delete('calibrated');
            
            // 페이지 새로고침 없이 주소창의 URL만 깔끔하게 갱신
            window.history.replaceState({}, '', cleanURL.toString());
            // this.log('🧹 URL 파라미터 정돈 완료');
        }

        /**
         * #### jumpUI 전용 스타일 적용
         * @returns {void} - 
         */
        applyJumpUIStyles()
        {
            const style = document.createElement('style');
            style.id = 'jump-ui-style';
            style.textContent = `
                div.jump-ui-wrapper {
                    display: inline-block;
                    margin-left: 10px;
                    font-size: 12px;
                }
                input.jump-ui-input {
                    width: 140px;
                    height: 26px;
                    padding: 0 6px;
                    border: 1px solid #555 !important;
                    border-radius: 3px !important;
                    box-sizing: border-box !important;
                    font-size: 12px !important;
                    vertical-align: middle;
                    /* 다크모드 및 라이트모드 호환을 위해 사이트 기본 배경/글자색 상속 또는 다크톤 적용 */
                    background-color: inherit !important;
                    color: inherit !important;
                }
                button.jump-ui-button {
                    margin-left: 4px;
                    padding: 0 10px;
                    height: 26px;
                    box-sizing: border-box !important;
                    display: inline-flex !important;
                    justify-content: center !important;
                    align-items: center !important;
                    font-size: 12px !important;
                    font-weight: bold !important;
                    color: #fff !important;
                    white-space: nowrap;
                    border: 1px solid #3b5998 !important;
                    background-color: #3b5998 !important;
                    border-radius: 3px !important;
                    cursor: pointer;
                    vertical-align: middle;
                }
            `;
            document.head.appendChild(style);
        }

        /**
         * #### 페이지 이동 UI 생성 및 페이지에 삽입
         * @returns {void} - 
         */
        createJumpUI()
        {
            const targetContainer = document.querySelector('.gal_srh_box') || document.querySelector('.array_tab');
            if (!targetContainer)
                return;

            // 스타일이 주입되어 있지 않다면 최초 1회 주입
            if (!document.getElementById('jump-ui-style'))
                this.applyJumpUIStyles();

            const currentUrlParams = new URLSearchParams(window.location.search);
            const searchedNo = currentUrlParams.get('target_no');

            const wrapper = document.createElement('div');
            wrapper.className = 'jump-ui-wrapper';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'jump-ui-input';
            input.placeholder = searchedNo ? `이전 검색: ${searchedNo}` : '글 번호 또는 URL 입력';
            if (searchedNo)
                input.value = searchedNo;

            const button = document.createElement('button');
            button.innerText = '페이지 이동';
            button.className = 'jump-ui-button';

            button.addEventListener('click', () => this.handleJump(input));
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter')
                    this.handleJump(input);
            });

            wrapper.appendChild(input);
            wrapper.appendChild(button);
            targetContainer.appendChild(wrapper);
        }

        /**
         * #### 버튼 클릭/엔터 시 해당 글 번호로 점프 처리 시작
         * @param {HTMLInputElement} inputElement - input 객체
         * @returns {void} - 
         */
        async handleJump(inputElement)
        {
            const rawValue = inputElement.value;
            const targetNo = this.extractPostNo(rawValue);

            if (!targetNo || targetNo <= 0)
            {
                this.showToast('올바른 글 번호 또는 게시글 URL을 입력해 주세요.');
                return;
            }

            // 비동기 호출 및 대기
            const latestNo = await this.getLatestPostNo();
            if (!latestNo)
            {
                this.showToast('최신 글 번호를 불러올 수 없습니다.');
                return;
            }

            let calculatedPage = 1;

            if (targetNo > latestNo)
            {
                this.showToast('입력한 글 번호(' + targetNo + ')가 현재 최신 글 번호(' + latestNo + ')보다 큽니다. 1페이지로 이동합니다.');
                
                calculatedPage = 1;
            }
            else
            {
                calculatedPage = Math.floor((latestNo - targetNo) / this.postsPerPage) + 1;
            }

            // this.log(`점프 실행: 목표 글(${targetNo}) -> 계산된 페이지(${calculatedPage})`);

            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('page', calculatedPage.toString());
            targetUrl.searchParams.set('target_no', targetNo.toString());
            targetUrl.searchParams.delete('exception_mode');
            targetUrl.searchParams.delete('calibrated');

            window.location.href = targetUrl.toString();
        }

        /**
         * #### 안내용 토스트 메시지
         * @param {string} message - 메시지 값
         * @param {number} duration - 지속 시간
         * @returns {void} - 
         */
        showToast(message, duration = 1500)
        {
            // 이미 토스트가 있다면 중복 생성 방지 위해 제거
            const existingToast = document.getElementById('jk-toast-message');
            if (existingToast)
                existingToast.remove();

            const toast = document.createElement('div');
            toast.id = 'jk-toast-message';
            toast.innerText = message;
            
            // 토스트 기본 스타일 지정
            Object.assign(toast.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                color: '#fff',
                padding: '10px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '500',
                zIndex: '999999',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                transition: 'opacity 0.3s ease-in-out',
                opacity: '0'
            });

            document.body.appendChild(toast);

            // 페이드 인 효과
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
            });

            // 지정된 시간 뒤에 페이드 아웃 후 제거
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                    if (toast.parentElement)
                        toast.remove();
                }, 300); // 트랜지션 시간 대기 후 DOM에서 삭제
            }, duration);
        }

        // MARK: 세션 스토리지 헬퍼 함수

        // 보정용 정보 불러오기
        getSessionState()
        {
            const rawRatio = sessionStorage.getItem('jk_density_ratio');
            const parsedRatio = parseFloat(rawRatio);

            return {
                prevPage: parseInt(sessionStorage.getItem('jk_prev_page'), 10) || NaN,
                prevMidNo: parseInt(sessionStorage.getItem('jk_prev_mid_no'), 10) || NaN,
                densityRatio: (rawRatio === null || isNaN(parsedRatio)) ? 1.0 : parsedRatio
            };
        }

        // 보정용 정보 저장
        setSessionState(page, midNo, ratio)
        {
            sessionStorage.setItem('jk_prev_page', page.toString());
            sessionStorage.setItem('jk_prev_mid_no', midNo.toString());
            sessionStorage.setItem('jk_density_ratio', ratio.toString());
        }

        // 보정용 정보 제거
        clearSessionState()
        {
            sessionStorage.removeItem('jk_prev_page');
            sessionStorage.removeItem('jk_prev_mid_no');
            sessionStorage.removeItem('jk_density_ratio');
        }

        // 전용 로거
        log(msg)
        {
            if(this.isDebug)
                console.log(`[JKDPF] ${msg}`);
        }

    }

    // MARK: 실행 영역
    new JKDCPageFinder();
})();