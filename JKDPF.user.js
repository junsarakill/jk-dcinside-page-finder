// ==UserScript==
// @name         디시 글 번호/URL로 해당 글 위치한 페이지로 이동
// @namespace    http://tampermonkey.net/
// @version      1.0
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

    // 목록에서 일반 게시글들의 글 번호 배열 추출 (공지 등 제외)
    function getPagePostNumbers()
    {
        const rows = document.querySelectorAll('.gall_list .ub-content');
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

    // 최신 일반 게시글 번호 추출
    function getLatestPostNo()
    {
        const numbers = getPagePostNumbers();
        return numbers.length > 0 ? numbers[0] : null;
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
            return;

        const postNumbers = getPagePostNumbers();
        if (postNumbers.length === 0)
            return;

        const maxNo = postNumbers[0]; // 현재 페이지의 가장 큰 글 번호
        const minNo = postNumbers[postNumbers.length - 1]; // 현재 페이지의 가장 작은 글 번호

        // 목표 글 번호가 현재 페이지 범위 내에 있다면 보정 완료
        if (targetNo >= minNo && targetNo <= maxNo)
            return;

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

            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('page', finalPage.toString());
            targetUrl.searchParams.set('target_no', targetNo.toString());
            // 무한 루프 방지를 위한 보정 수행 플래그 설정
            targetUrl.searchParams.set('calibrated', '1');

            window.location.href = targetUrl.toString();
        }
    }

    // UI 생성 및 화면 삽입
    function createJumpUI()
    {
        const targetContainer = document.querySelector('.gal_srh_box') || document.querySelector('.array_tab');
        if (!targetContainer)
            return;

        const currentUrlParams = new URLSearchParams(window.location.search);
        const searchedNo = currentUrlParams.get('target_no');

        const wrapper = document.createElement('div');
        wrapper.style.display = 'inline-block';
        wrapper.style.marginLeft = '10px';
        wrapper.style.fontSize = '12px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = searchedNo ? `이전 검색: ${searchedNo}` : '글 번호 또는 URL 입력';
        if (searchedNo)
            input.value = searchedNo;
        
        input.style.width = '140px';
        input.style.height = '26px';
        input.style.padding = '0 6px';
        input.style.border = '1px solid #ccc';
        input.style.borderRadius = '3px';
        input.style.boxSizing = 'border-box';
        input.style.fontSize = '12px';
        input.style.verticalAlign = 'middle';

        // 버튼 요소 생성 및 스타일 정의
        const button = document.createElement('button');
        button.innerText = '페이지 이동';

        button.style.marginLeft = '4px';
        button.style.padding = '0 10px';
        button.style.height = '26px';
        button.style.boxSizing = 'border-box';

        button.style.display = 'inline-flex';
        button.style.justifyContent = 'center';
        button.style.alignItems = 'center';

        button.style.fontSize = '12px';
        button.style.fontWeight = 'bold';
        button.style.color = '#fff';
        button.style.whiteSpace = 'nowrap';

        button.style.border = '1px solid #3b5998';
        button.style.backgroundColor = '#3b5998';
        button.style.borderRadius = '3px';
        button.style.cursor = 'pointer';
        button.style.verticalAlign = 'middle';

        const handleJump = () => {
            const rawValue = input.value;
            const targetNo = extractPostNo(rawValue);

            if (!targetNo || targetNo <= 0)
            {
                alert('올바른 글 번호 또는 게시글 URL을 입력해 주세요.');
                return;
            }

            const latestNo = getLatestPostNo();
            if (!latestNo)
            {
                alert('최신 글 번호를 불러올 수 없습니다.');
                return;
            }

            if (targetNo > latestNo)
            {
                alert('입력한 글 번호(' + targetNo + ')가 현재 최신 글 번호(' + latestNo + ')보다 큽니다. 1페이지로 이동합니다.');
                const url = new URL(window.location.href);
                url.searchParams.set('page', '1');
                url.searchParams.set('target_no', targetNo.toString());
                url.searchParams.delete('calibrated');
                window.location.href = url.toString();
                return;
            }

            const postsPerPage = 50;
            const calculatedPage = Math.floor((latestNo - targetNo) / postsPerPage) + 1;

            const targetUrl = new URL(window.location.href);
            targetUrl.searchParams.set('page', calculatedPage.toString());
            targetUrl.searchParams.set('target_no', targetNo.toString());
            // 새로운 검색 시 이전 보정 플래그 제거
            targetUrl.searchParams.delete('calibrated');

            window.location.href = targetUrl.toString();
        };

        button.addEventListener('click', handleJump);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter')
            {
                handleJump();
            }
        });

        wrapper.appendChild(input);
        wrapper.appendChild(button);
        targetContainer.appendChild(wrapper);
    }

    window.addEventListener('load', () => {
        createJumpUI();
        autoCalibratePosition();
    });
})();