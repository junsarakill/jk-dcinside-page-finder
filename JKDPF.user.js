// ==UserScript==
// @name         디시 글 번호/URL로 해당 글 위치한 페이지로 이동
// @namespace    http://tampermonkey.net/
// @version      1.2
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

    // @@ 연습 삼아 클래스 구조로 바꿔보기
    class JKDCPageFinder {
        constructor() 
        {
            this.init();
        }
    }

    // MARK: 실행 영역
    // new JKDCPageFinder();

    // 현재 페이지 일반 게시글들의 글 번호 배열 추출 (공지 등 제외)
    function getPagePostNumbers()
    {
        return extractPostNumbersFromDoc(document);
    }

    // 목록에서 주어진 문서(doc 또는 window)의 일반 게시글들의 글 번호 배열 추출
    function extractPostNumbersFromDoc(docContext)
    {
        const rows = docContext.querySelectorAll('.gall_list .ub-content');
        const numbers = [];

        for (const row of rows)
        {
            if (row.classList.contains('notice') || row.classList.contains('issue-wrap'))
                continue;

            const noticeIcon = row.querySelector('.icon_notice, .icon_survey, .icon_ad');
            if (noticeIcon)
                continue;

            const headText = row.querySelector('.gall_subject, .head_text');
            if (headText && headText.innerText.includes('공지'))
                continue;

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

    // 최신 일반 게시글 번호 추출 (비동기 처리로 백그라운드 1페이지 조회 지원)
    async function getLatestPostNo()
    {
        const urlParams = new URLSearchParams(window.location.search);
        const currentPage = parseInt(urlParams.get('page') || '1', 10);

        // 이미 1페이지에 있다면 현재 DOM에서 바로 추출
        if (currentPage === 1)
        {
            const numbers = getPagePostNumbers();
            return numbers.length > 0 ? numbers[0] : null;
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

            const numbers = extractPostNumbersFromDoc(doc);
            return numbers.length > 0 ? numbers[0] : null;
        }
        catch (error)
        {
            console.error('1페이지 최신글 조회 실패:', error);
            const numbers = getPagePostNumbers();
            return numbers.length > 0 ? numbers[0] : null;
        }
    }

    // 입력값에서 글 번호만 추출
    function extractPostNo(inputStr)
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

    // 페이지 이동 후 범위 이탈 시 정밀 보정 수행
    function autoCalibratePosition()
    {
        const currentUrlParams = new URLSearchParams(window.location.search);
        const targetNo = parseInt(currentUrlParams.get('target_no'), 10);
        const currentPage = parseInt(currentUrlParams.get('page') || '1', 10);
        const isCalibrated = currentUrlParams.get('calibrated') === '1';

        // target_no가 없거나 이미 보정을 마친 상태라면 종료
        if (isNaN(targetNo) || isCalibrated)
        {
            // console.log('[JKDPF] 자동 보정 스킵: target_no가 없거나 이미 보정됨');
            return;
        }

        const postNumbers = getPagePostNumbers();
        if (postNumbers.length === 0)
        {
            // console.log('[JKDPF] 자동 보정 스킵: 현재 페이지 글 목록을 찾을 수 없음');
            return;
        }

        const maxNo = postNumbers[0]; // 현재 페이지의 가장 큰 글 번호
        const minNo = postNumbers[postNumbers.length - 1]; // 현재 페이지의 가장 작은 글 번호

        // 목표 글 번호가 현재 페이지 범위 내에 있다면 보정 완료
        if (targetNo >= minNo && targetNo <= maxNo)
        {
            // console.log(`[JKDPF] 🎉 목표 글(${targetNo})이 현재 페이지 범위(${minNo} ~ ${maxNo}) 내에 존재합니다. 보정 작업이 성공적으로 완료되었습니다.`);

            // 작동 플로우 종료시점
            cleanUpUrlParams();
            return;
        }

        const postsPerPage = 50;
        let diffPage = 0;

        // 목표 번호가 현재 페이지 최소 번호보다 작음 -> 더 과거 페이지(page 증가)로 이동
        if (targetNo < minNo)
            diffPage = Math.max(1, Math.floor((minNo - targetNo) / postsPerPage));
        // 목표 번호가 현재 페이지 최대 번호보다 큼 -> 더 최신 페이지(page 감소)로 이동
        else if (targetNo > maxNo)
            diffPage = -Math.max(1, Math.floor((targetNo - maxNo) / postsPerPage));

        if (diffPage !== 0)
        {
            const calibratedPage = Math.max(1, currentPage + diffPage);

            // 무한 리다이렉트 방지 및 목적지 페이지가 동일할 경우 차이 1 부여
            const finalPage = (calibratedPage === currentPage) ? currentPage + (diffPage > 0 ? 1 : -1) : calibratedPage;

            // console.log(`[JKDPF] 🔄 오차 감지: 목표 글(${targetNo})이 현재 범위 외에 있어 ${finalPage}페이지로 정밀 보정 이동합니다.`);

            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('page', finalPage.toString());
            targetUrl.searchParams.set('target_no', targetNo.toString());
            // 무한 루프 방지를 위한 보정 수행 플래그 설정
            targetUrl.searchParams.set('calibrated', '1');

            window.location.href = targetUrl.toString();
        }
    }

    /**
     * #### 이동 작업 종료 후 URL에 남은 스크립트 전용 파라미터 정리
     * @returns {void} - 
     */
    function cleanUpUrlParams()
    {
        const cleanURL = new URL(window.location.href);
        cleanURL.searchParams.delete('target_no');
        cleanURL.searchParams.delete('calibrated');
        
        // 페이지 새로고침 없이 주소창의 URL만 깔끔하게 갱신
        window.history.replaceState({}, '', cleanURL.toString());
        // console.log('[JKDPF] 🧹 URL 파라미터 정돈 완료');
    }

    // 스크립트 전용 스타일 적용
    function applyJumpUIStyles()
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

    // UI 생성 및 화면 삽입
    function createJumpUI()
    {
        const targetContainer = document.querySelector('.gal_srh_box') || document.querySelector('.array_tab');
        if (!targetContainer)
            return;

        // 스타일이 주입되어 있지 않다면 최초 1회 주입
        if (!document.getElementById('jump-ui-style'))
            applyJumpUIStyles();

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

        button.addEventListener('click', () => handleJump(input));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter')
                handleJump(input);
        });

        wrapper.appendChild(input);
        wrapper.appendChild(button);
        targetContainer.appendChild(wrapper);
    }

    // 버튼 클릭 또는 엔터 시 실행되는 점프 처리 함수
    async function handleJump(inputElement)
    {
        const rawValue = inputElement.value;
        const targetNo = extractPostNo(rawValue);

        if (!targetNo || targetNo <= 0)
        {
            showToast('올바른 글 번호 또는 게시글 URL을 입력해 주세요.');
            return;
        }

        // 비동기 호출 및 대기
        const latestNo = await getLatestPostNo();
        if (!latestNo)
        {
            showToast('최신 글 번호를 불러올 수 없습니다.');
            return;
        }

        if (targetNo > latestNo)
        {
            showToast('입력한 글 번호(' + targetNo + ')가 현재 최신 글 번호(' + latestNo + ')보다 큽니다. 1페이지로 이동합니다.');
            const url = new URL(window.location.href);
            url.searchParams.set('page', '1');
            url.searchParams.set('target_no', targetNo.toString());
            url.searchParams.delete('calibrated');
            window.location.href = url.toString();
            return;
        }

        const postsPerPage = 50;
        const calculatedPage = Math.floor((latestNo - targetNo) / postsPerPage) + 1;

        // console.log(`[JKDPF] 점프 실행: 목표 글(${targetNo}) -> 계산된 페이지(${calculatedPage})`);

        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set('page', calculatedPage.toString());
        targetUrl.searchParams.set('target_no', targetNo.toString());
        targetUrl.searchParams.delete('calibrated');

        window.location.href = targetUrl.toString();
    }

    // 화면에 흘러가듯 잠시 나타났다 사라지는 토스트 메시지 함수
    function showToast(message, duration = 1500)
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

        // 지정된 시간(기본 2.5초) 뒤에 페이드 아웃 후 제거
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentElement)
                    toast.remove();
            }, 300); // 트랜지션 시간 대기 후 DOM에서 삭제
        }, duration);
    }

    // MARK: 실행 영역

    window.addEventListener('load', () => {
        createJumpUI();
        // URL에 target_no가 명시되어 있을 때만 자동 보정 로직 실행
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('target_no'))
            autoCalibratePosition();
    });
})();